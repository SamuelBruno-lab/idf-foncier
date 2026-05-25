"""
DATAMERRY — Setup automatique en 1 commande.

Applique les 3 migrations SQL Supabase, émet les clés pilote Collabimmo,
et affiche tout ce dont Samuel a besoin pour transmettre à Diara.

Usage:
    cd foncier-idf
    python scripts/setup-datamerry.py

Ce que le script fait :
  1. Demande ta Postgres URI Supabase (Dashboard → Settings → Database → URI)
  2. Applique sql/22_api_keys.sql + 23_property_report_cache.sql + 24_widget_keys.sql
  3. Vérifie que les tables sont bien créées
  4. Émet 1 clé pilote serveur (dmk_live_…) et 1 clé widget (wdmk_live_…) pour Collabimmo
  5. Insère les enregistrements dans dim_api_keys
  6. Affiche les clés en clair (à transmettre, NON RÉCUPÉRABLES ensuite)

Dépendances :
    pip install psycopg[binary]
"""

import sys
import os
import getpass
import secrets
import hashlib
from pathlib import Path

try:
    import psycopg
except ImportError:
    print("\n❌ psycopg n'est pas installé.")
    print("   Installe-le avec :  python -m pip install 'psycopg[binary]'")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

BASE32_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"


def generate_key(prefix: str = "dmk", env: str = "live", length: int = 32) -> str:
    """Génère une clé au format prefix_env_<base32>. ~160 bits d'entropie."""
    raw = secrets.token_bytes(length)
    body = "".join(BASE32_ALPHABET[b % len(BASE32_ALPHABET)] for b in raw[:length])
    return f"{prefix}_{env}_{body}"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def banner(text: str) -> None:
    print("\n" + "─" * 70)
    print(f"  {text}")
    print("─" * 70)


def section(text: str) -> None:
    print(f"\n▶ {text}")


# ─────────────────────────────────────────────────────────────────────────────
# Connection helper
# ─────────────────────────────────────────────────────────────────────────────

def prompt_connection() -> str:
    """Demande la Postgres URI ou la lit depuis l'environnement."""
    env_uri = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if env_uri:
        print(f"✅ Connection URI trouvée dans l'environnement.")
        return env_uri

    print("\nRécupère ta Postgres URI Supabase :")
    print("  1. Dashboard Supabase → ton projet → ⚙️ Settings → Database")
    print("  2. Section 'Connection string' → onglet 'URI' (mode 'Session' recommandé)")
    print("  3. Copie la valeur (commence par 'postgresql://postgres...')")
    print("     ⚠️  Remplace [YOUR-PASSWORD] par ton vrai mot de passe DB")
    print()
    uri = getpass.getpass("Colle ta Postgres URI ici (masqué) : ").strip()
    if not uri or not uri.startswith(("postgres://", "postgresql://")):
        print("❌ URI invalide. Doit commencer par 'postgresql://'.")
        sys.exit(1)
    return uri


# ─────────────────────────────────────────────────────────────────────────────
# Migration application
# ─────────────────────────────────────────────────────────────────────────────

SQL_FILES = [
    "22_api_keys.sql",
    "23_property_report_cache.sql",
    "24_widget_keys.sql",
]


def apply_migrations(conn: "psycopg.Connection") -> None:
    section("Application des 3 migrations SQL")
    sql_dir = Path(__file__).resolve().parent.parent / "sql"

    for fname in SQL_FILES:
        path = sql_dir / fname
        if not path.exists():
            print(f"  ❌ Fichier introuvable : {path}")
            sys.exit(1)
        sql = path.read_text(encoding="utf-8")
        print(f"  → {fname} ({path.stat().st_size:,} bytes)")
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
            print(f"     ✅ Appliqué")
        except Exception as e:
            conn.rollback()
            print(f"     ❌ Erreur : {e}")
            print(f"\n     Tu peux relancer le script — les migrations sont idempotentes")
            print(f"     (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, etc.)")
            sys.exit(1)


def verify_schema(conn: "psycopg.Connection") -> bool:
    section("Vérification du schéma déployé")
    expected_tables = {
        "dim_api_keys",
        "api_usage_log",
        "property_report_cache",
    }
    expected_view = "v_api_usage_monthly"
    expected_cols = {
        "allowed_referrers",
        "widget_views_count",
        "monthly_quota",
        "plan",
    }

    with conn.cursor() as cur:
        # Tables
        cur.execute(
            """
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            """,
            (list(expected_tables) + [expected_view],),
        )
        rows = cur.fetchall()
        found = {r[0] for r in rows}

        missing_tables = expected_tables - found
        view_ok = expected_view in found

        if missing_tables:
            print(f"  ❌ Tables manquantes : {missing_tables}")
            return False
        print(f"  ✅ Tables présentes : {sorted(expected_tables)}")
        if view_ok:
            print(f"  ✅ Vue présente : {expected_view}")

        # Colonnes
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'dim_api_keys'
              AND column_name = ANY(%s)
            """,
            (list(expected_cols),),
        )
        cols_found = {r[0] for r in cur.fetchall()}
        missing_cols = expected_cols - cols_found
        if missing_cols:
            print(f"  ❌ Colonnes manquantes sur dim_api_keys : {missing_cols}")
            return False
        print(f"  ✅ Colonnes critiques OK : {sorted(expected_cols)}")

    return True


# ─────────────────────────────────────────────────────────────────────────────
# Émission de clés
# ─────────────────────────────────────────────────────────────────────────────

def issue_pilot_keys(conn: "psycopg.Connection") -> dict:
    section("Émission des clés Collabimmo (pilote)")

    cabinet = "Collabimmo"
    email = "diara@collabimmo.fr"
    referrers = ["collabimmo.fr", "www.collabimmo.fr", "*.collabimmo.fr"]

    # 1) Clé serveur (dmk_live_…) — pilote tarif gelé
    server_key = generate_key("dmk", "live")
    server_hash = hash_key(server_key)
    server_prefix = server_key[:8]

    # 2) Clé widget (wdmk_live_…) — restreinte par domaine
    widget_key = generate_key("wdmk", "live")
    widget_hash = hash_key(widget_key)
    widget_prefix = widget_key[:8]

    with conn.cursor() as cur:
        # Server key
        try:
            cur.execute(
                """
                INSERT INTO dim_api_keys
                  (cabinet_name, contact_email, key_prefix, key_hash, plan,
                   monthly_quota, overage_per_1k_eur_ttc, first_month_free, notes)
                VALUES (%s, %s, %s, %s, 'pilot', 50000, 0, false, %s)
                RETURNING id
                """,
                (
                    cabinet,
                    email,
                    server_prefix,
                    server_hash,
                    "Pilote n°1 — tarif gelé 39€/mo à vie (avenant signé). "
                    "Cf. memory/market_competitors.md.",
                ),
            )
            server_id = cur.fetchone()[0]
            print(f"  ✅ Clé serveur émise — id : {server_id}")
        except psycopg.errors.UniqueViolation:
            conn.rollback()
            print(f"  ⚠️ Conflit sur clé serveur (collision SHA-256 extrêmement improbable)")
            print(f"     Relance le script pour régénérer.")
            sys.exit(1)

        # Widget key
        try:
            cur.execute(
                """
                INSERT INTO dim_api_keys
                  (cabinet_name, contact_email, key_prefix, key_hash, plan,
                   monthly_quota, overage_per_1k_eur_ttc, first_month_free,
                   allowed_referrers, notes)
                VALUES (%s, %s, %s, %s, 'widget', 5000, 0, false, %s, %s)
                RETURNING id
                """,
                (
                    cabinet,
                    email,
                    widget_prefix,
                    widget_hash,
                    referrers,
                    "Clé widget restreinte aux domaines Collabimmo. "
                    "Pour intégration <div data-datamerry-report> et <div data-datamerry-chatbot>.",
                ),
            )
            widget_id = cur.fetchone()[0]
            print(f"  ✅ Clé widget émise — id : {widget_id}")
        except psycopg.errors.UniqueViolation:
            conn.rollback()
            print(f"  ⚠️ Conflit sur clé widget")
            sys.exit(1)

    conn.commit()

    return {
        "server_key": server_key,
        "widget_key": widget_key,
        "cabinet": cabinet,
        "email": email,
        "referrers": referrers,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Output récapitulatif
# ─────────────────────────────────────────────────────────────────────────────

def print_summary(keys: dict) -> None:
    banner("✅ SETUP DATAMERRY TERMINÉ")
    print()
    print(f"  Cabinet pilote   : {keys['cabinet']}")
    print(f"  Email contact    : {keys['email']}")
    print(f"  Domaines widget  : {', '.join(keys['referrers'])}")
    print()
    print("─" * 70)
    print("  CLÉS EN CLAIR (à transmettre à Diara, NON RÉCUPÉRABLES après ce run)")
    print("─" * 70)
    print()
    print("  📡 Clé serveur (intégration backend / API JSON / PDF) :")
    print(f"     {keys['server_key']}")
    print()
    print("  🌐 Clé widget (snippets HTML widget + chatbot embed) :")
    print(f"     {keys['widget_key']}")
    print()
    print("─" * 70)
    print("  SNIPPETS HTML PRÊTS POUR DIARA")
    print("─" * 70)
    print()
    print("  Widget rapport (4 lignes HTML) :")
    print()
    print('     <script src="https://datamerry.com/widget.js" async></script>')
    print('     <div data-datamerry-report')
    print(f'          data-key="{keys["widget_key"]}"')
    print('          data-address="10 rue de Rivoli 75001"')
    print('          data-surface="62"')
    print('          data-color="#c2410c"></div>')
    print()
    print("  Chatbot conversationnel (4 lignes HTML) :")
    print()
    print('     <script src="https://datamerry.com/chatbot.js" async></script>')
    print('     <div data-datamerry-chatbot')
    print(f'          data-key="{keys["widget_key"]}"')
    print('          data-cabinet="Collabimmo"')
    print('          data-color="#c2410c"></div>')
    print()
    print("  Lien chatbot direct (à mettre dans WhatsApp/email) :")
    print()
    print(
        f"     https://datamerry.com/chatbot?key={keys['widget_key']}"
        f"&cabinet=Collabimmo&color=%23c2410c"
    )
    print()
    print("  Test API serveur (curl) :")
    print()
    print(
        f'     curl -H "X-API-Key: {keys["server_key"]}" \\\n'
        f'          "https://datamerry.com/api/address/search?q=10+rue+de+rivoli+75001"'
    )
    print()
    print("─" * 70)
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    banner("DATAMERRY — Setup automatique Supabase + clés pilote")

    uri = prompt_connection()

    section("Connexion à Supabase Postgres")
    try:
        with psycopg.connect(uri, connect_timeout=10) as conn:
            print(f"  ✅ Connecté.")

            apply_migrations(conn)
            if not verify_schema(conn):
                print("\n❌ Vérification échouée. Inspecte ton dashboard Supabase.")
                sys.exit(1)

            keys = issue_pilot_keys(conn)

            print_summary(keys)

            # Sauvegarde optionnelle des clés dans un fichier local
            backup_path = Path(__file__).resolve().parent.parent / ".collabimmo-keys-backup.txt"
            try:
                backup_path.write_text(
                    f"# DATAMERRY — Clés pilote Collabimmo\n"
                    f"# Générées par scripts/setup-datamerry.py\n"
                    f"# ⚠️ NE PAS COMMITTER (ajouté à .gitignore)\n\n"
                    f"CABINET={keys['cabinet']}\n"
                    f"EMAIL={keys['email']}\n"
                    f"SERVER_KEY={keys['server_key']}\n"
                    f"WIDGET_KEY={keys['widget_key']}\n"
                    f"REFERRERS={','.join(keys['referrers'])}\n",
                    encoding="utf-8",
                )
                print(f"  💾 Backup sauvé localement : {backup_path}")
                print(f"     (Pense à ajouter ce fichier à .gitignore !)")
                print()
            except Exception as e:
                print(f"  ⚠️ Backup local échoué : {e} (clés ci-dessus suffisent)")

    except psycopg.OperationalError as e:
        print(f"\n❌ Connexion échouée : {e}")
        print("   Vérifie ta Postgres URI (mot de passe DB, IP allowlist côté Supabase).")
        sys.exit(1)


if __name__ == "__main__":
    main()

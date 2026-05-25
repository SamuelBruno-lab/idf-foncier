/**
 * Layout iframe-friendly pour /chatbot/embed.
 *
 * Le Root layout applique un <Header /> global pour le site datamerry.com.
 * En contexte iframe (embed côté cabinet), on ne veut PAS afficher ce header.
 * On le masque + on retire les margins du body pour un rendu propre.
 */

export default function ChatbotEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style
        // eslint-disable-next-line react/no-unknown-property
        dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0 !important; padding: 0 !important; background: transparent !important; }
            body > header,
            body > div > header,
            body > nav,
            body > div > nav {
              display: none !important;
            }
          `,
        }}
      />
      {children}
    </>
  );
}

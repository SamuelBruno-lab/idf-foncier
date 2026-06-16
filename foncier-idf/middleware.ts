import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  // Sous-domaine estimer.collabimo.com → widget capture de lead Collabimo
  if (host === 'estimer.collabimo.com') {
    if (url.pathname.startsWith('/cabinets/collabimo/estimer')) {
      return NextResponse.next();
    }
    const targetPath = url.pathname === '/'
      ? '/cabinets/collabimo/estimer'
      : `/cabinets/collabimo/estimer${url.pathname}`;
    url.pathname = targetPath;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const appPassword = process.env.APP_PASSWORD;

    if (!appPassword) {
      return NextResponse.json(
        { error: 'Passwortschutz ist auf diesem Server deaktiviert.' },
        { status: 400 }
      );
    }

    if (password === appPassword) {
      const response = NextResponse.json({ success: true });
      
      // Set session cookie
      response.cookies.set('app_session', appPassword, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 30, // 30 days session
        path: '/'
      });

      return response;
    }

    return NextResponse.json(
      { error: 'Falsches Passwort. Bitte versuchen Sie es erneut.' },
      { status: 401 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Ungültige Anfrage: ' + error.message },
      { status: 500 }
    );
  }
}

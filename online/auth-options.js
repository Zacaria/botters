// Shared by the real Convex adapter and isolated library-level HTTP tests.
export function authOptions(env, sendEmail) {
  const baseURL = env.SITE_URL
  if (!baseURL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('Authentication is not configured.')
  return {
    appName: 'Botters', baseURL, basePath: '/api/auth', secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL], logger: { disabled: true }, onAPIError: { errorURL: `${baseURL}/?error=signin` },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: ({ user, url }) => sendEmail({ to: user.email, subject: 'Reset your Botters password', text: `Reset your Botters password:\n${url}\n\nThis link expires in one hour. If you did not request it, ignore this email.` }),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true, expiresIn: 3600,
      sendVerificationEmail: ({ user, url }) => sendEmail({ to: user.email, subject: 'Verify your Botters email', text: `Verify your email to play Botters:\n${url}\n\nThis link expires in one hour. If you did not create this account, ignore this email.` }),
    },
    socialProviders: env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? {
      google: { clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET, scope: ['openid', 'email', 'profile'], prompt: 'select_account' },
    } : {},
    account: { accountLinking: { enabled: false }, storeAccountCookie: false, encryptOAuthTokens: true },
    session: { expiresIn: 604800, updateAge: 86400, cookieCache: { enabled: false } },
    // Every game request checks the live cookie through this proxy-secret-protected
    // endpoint. Polling must not consume the credential/email request budget.
    rateLimit: { enabled: true, storage: 'database', window: 600, max: 100, customRules: { '/get-session': false, '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 600, max: 5 }, '/request-password-reset': { window: 600, max: 3 }, '/send-verification-email': { window: 600, max: 3 } } },
    advanced: { useSecureCookies: baseURL.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: baseURL.startsWith('https:') }, ipAddress: { ipAddressHeaders: ['x-botters-client-ip'] } },
  }
}

export async function deliverAuthEmail(env, message) {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) throw new Error('Email delivery is not configured.')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, ...message }), signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error('Email delivery is unavailable.')
}

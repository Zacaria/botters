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
    rateLimit: { enabled: true, storage: 'database', window: 600, max: 100, customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 600, max: 5 }, '/request-password-reset': { window: 600, max: 3 }, '/send-verification-email': { window: 600, max: 3 } } },
    advanced: { useSecureCookies: baseURL.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: baseURL.startsWith('https:') }, ipAddress: { ipAddressHeaders: ['x-botters-client-ip'] } },
  }
}

export async function deliverAuthEmail(env, message) {
  const provider = env.AUTH_EMAIL_PROVIDER ?? 'resend'
  if (!env.AUTH_EMAIL_FROM || !['resend', 'cloudflare'].includes(provider) ||
    (provider === 'resend' ? !env.RESEND_API_KEY : !env.CLOUDFLARE_EMAIL_API_TOKEN || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || ''))) {
    throw new Error('Email delivery is not configured.')
  }
  const cloudflare = provider === 'cloudflare'
  const endpoint = cloudflare ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send` : 'https://api.resend.com/emails'
  try {
    const r = await fetch(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${cloudflare ? env.CLOUDFLARE_EMAIL_API_TOKEN : env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: message.to, subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(8000), redirect: 'error',
    })
    if (!r.ok) throw new Error()
    if (!cloudflare) return { provider, status: 'accepted' }
    const body = await r.json(), result = body?.result
    if (body?.success !== true || !Array.isArray(body.errors) || body.errors.length || !result ||
      !Array.isArray(result.delivered) || !Array.isArray(result.queued) ||
      !Array.isArray(result.permanent_bounces) || result.permanent_bounces.length ||
      (result.suppressed_recipients !== undefined && (!Array.isArray(result.suppressed_recipients) || result.suppressed_recipients.length))) throw new Error()
    const accepted = [...result.delivered, ...result.queued]
    if (accepted.length !== 1 || accepted[0] !== message.to) throw new Error()
    return { provider, status: result.queued.length ? 'queued' : 'delivered', ...(typeof result.message_id === 'string' ? { messageId: result.message_id } : {}) }
  } catch {
    // Do not expose provider bodies/auth links or retry an ambiguously accepted email.
    throw new Error('Email delivery is unavailable.')
  }
}

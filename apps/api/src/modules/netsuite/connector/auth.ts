import crypto from 'crypto';

/**
 * NetSuite OAuth 1.0 HMAC-SHA1 signing utility.
 *
 * NetSuite's REST API uses OAuth 1.0 with token-based auth (not OAuth 2.0).
 * Every request must have a signed Authorization header.
 */

interface OAuth10aParams {
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  realm: string;
  method: string;
  url: string;
  queryParams?: Record<string, string>;
}

/**
 * Generate a random nonce (16 chars hex).
 */
function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate OAuth 1.0 timestamp (seconds since epoch).
 */
function generateTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * RFC 3986 percent-encode a string.
 * NetSuite is strict about this — must match spec exactly.
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/**
 * Build the OAuth 1.0 signature base string and sign it with HMAC-SHA1.
 *
 * Steps:
 * 1. Collect all parameters (OAuth + query) and sort by key, then value
 * 2. Build the parameter string: key=value&key=value...
 * 3. Build the signature base: METHOD & BASE_URL & PARAM_STRING
 * 4. Build the signing key: CONSUMER_SECRET&TOKEN_SECRET
 * 5. HMAC-SHA1(base, key) → base64 encode
 */
function sign(params: OAuth10aParams & { nonce: string; timestamp: string }): string {
  // 1. Collect all parameters
  const allParams: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: params.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: params.timestamp,
    oauth_token: params.tokenId,
    oauth_version: '1.0',
    ...(params.queryParams || {}),
  };

  // 2. Sort alphabetically by key, then by value
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');

  // 3. Build signature base string
  const baseUrl = params.url.split('?')[0]; // strip query params from URL
  const signatureBase = [
    params.method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join('&');

  // 4. Build signing key
  const signingKey = `${percentEncode(params.consumerSecret)}&${percentEncode(params.tokenSecret)}`;

  // 5. Sign with HMAC-SHA1
  const hmac = crypto.createHmac('sha1', signingKey);
  hmac.update(signatureBase);
  return hmac.digest('base64');
}

/**
 * Build the full Authorization header for a NetSuite REST API request.
 *
 * Usage:
 *   const header = buildAuthHeader({
 *     consumerKey: '...',
 *     consumerSecret: '...',
 *     tokenId: '...',
 *     tokenSecret: '...',
 *     realm: '1234567_SB1',
 *     method: 'GET',
 *     url: 'https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1&deploy=1',
 *   });
 *
 *   fetch(url, { headers: { Authorization: header } })
 */
export function buildAuthHeader(params: OAuth10aParams): string {
  const nonce = generateNonce();
  const timestamp = generateTimestamp();
  const signature = sign({ ...params, nonce, timestamp });

  const oauthParams = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: params.tokenId,
    oauth_version: '1.0',
    realm: params.realm,
  };

  // Build Authorization header value
  const headerParts = [
    `OAuth realm="${params.realm}"`,
    ...Object.entries(oauthParams)
      .filter(([k]) => k !== 'realm')
      .map(([key, val]) => `${key}="${percentEncode(val)}"`),
    `oauth_signature="${percentEncode(signature)}"`,
  ];

  return headerParts.join(',\n  ');
}

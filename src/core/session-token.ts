// Isomorphic session token encode/decode supporting Node.js and Browser environments.
export function encodeSessionToken(relativePath: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(relativePath, 'utf8').toString('base64url')
  }
  const bytes = new TextEncoder().encode(relativePath)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeSessionToken(token: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(token, 'base64url').toString('utf8')
  }
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

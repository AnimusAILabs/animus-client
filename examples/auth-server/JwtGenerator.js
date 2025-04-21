/**
 * JWT Generator for Animus AI Backend SDK
 * Creates and manages JWTs for authenticating frontend clients with the Animus API
 * and B2B clients with Kong API Gateway
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class JwtGenerator {
  /**
   * Create a new JWT Generator instance
   *
   * @param {string|Buffer} secretOrPrivateKey - The secret (for HS256) or private key (for RS256)
   * @param {Object} options - Configuration options
   * @param {string} options.issuer - JWT issuer claim
   * @param {string|number} options.expiresIn - JWT expiration time (e.g., '1h', 3600)
   * @param {string} options.algorithm - JWT signing algorithm (default: 'HS256')
   * @param {string|Buffer} options.publicKey - The public key for RS256 verification (only needed for RS256)
   */
  constructor(secretOrPrivateKey, options = {}) {
    if (!secretOrPrivateKey) {
      throw new Error('JWT secret or private key is required');
    }

    this.secretOrPrivateKey = secretOrPrivateKey;
    this.options = {
      issuer: options.issuer || 'animus-client-auth-server', // Example issuer
      expiresIn: options.expiresIn || '1h', // Default expiry
      algorithm: options.algorithm || 'HS256'
    };

    // Store public key for RS256 validation if provided
    if (this.options.algorithm === 'RS256') {
      this.publicKey = options.publicKey;
    }
  }

  /**
   * Generate a JWT for a user/client
   *
   * @param {string} subjectId - Subject claim (e.g., user ID or client ID)
   * @param {string} orgId - Organization ID for mapping to API key (example claim)
   * @param {Object} additionalClaims - Additional claims to include in the JWT
   * @param {Object} overrideOptions - Override default JWT options (like expiresIn)
   * @returns {string} - The generated JWT
   */
  generateToken(subjectId, orgId, additionalClaims = {}, overrideOptions = {}) {
    if (!subjectId) {
      throw new Error('Subject ID is required');
    }
    // orgId might not be strictly needed for client_credentials, adjust as needed
    // if (!orgId) {
    //   throw new Error('Organization ID is required');
    // }

    // Core payload
    const payload = {
      sub: subjectId,
      ...(orgId && { org_id: orgId }), // Include org_id if provided
      jti: uuidv4(), // Unique token ID
      ...additionalClaims
    };

    // Merge options
    const jwtOptions = { ...this.options, ...overrideOptions };

    // Generate the JWT
    return jwt.sign(payload, this.secretOrPrivateKey, jwtOptions);
  }

  /**
   * Validate a JWT (for testing and verification)
   *
   * @param {string} token - JWT to validate
   * @returns {Object} - The decoded payload if valid
   * @throws {Error} - If token is invalid
   */
  validateToken(token) {
    try {
      // For RS256, use the public key for verification
      const keyToUse = (this.options.algorithm === 'RS256' && this.publicKey)
        ? this.publicKey
        : this.secretOrPrivateKey;

      return jwt.verify(token, keyToUse, { algorithms: [this.options.algorithm] });
    } catch (error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
  }

  /**
   * Refresh a token with a new expiration time (Example implementation)
   * Note: Refresh token logic typically involves validating a separate refresh token,
   * which is not fully implemented here. This example just re-signs the payload.
   *
   * @param {string} token - Existing JWT to refresh (or a refresh token)
   * @param {string|number} expiresIn - New expiration time
   * @returns {string} - New JWT with updated expiration
   */
  refreshToken(token, expiresIn = this.options.expiresIn) {
    try {
      // Decode without verification to get the payload (INSECURE for actual refresh)
      // A real refresh would validate a refresh token first
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.sub) { // Check for subject
        throw new Error('Invalid token format for refresh');
      }

      // Generate a new token with the same core claims but new expiration
      return this.generateToken(
        decoded.sub,
        decoded.org_id, // Pass org_id if present
        // Exclude standard JWT claims we don't want to copy
        Object.entries(decoded)
          .filter(([key]) => !['iat', 'exp', 'nbf', 'jti', 'sub', 'org_id', 'iss'].includes(key))
          .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {}),
        { expiresIn }
      );
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  // B2B Token generation - might not be needed for this simple proxy
  // generateB2BToken(...) { ... }
}

module.exports = JwtGenerator;
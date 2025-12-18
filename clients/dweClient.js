// clients/dweClient.js
// Minimal DWE client stub so tests can mock it.
async function createDweToken(payload) {
  // In production, this would call the DWE API.
  return { dwe_token_id: 'DWE-000' };
}

module.exports = { createDweToken };

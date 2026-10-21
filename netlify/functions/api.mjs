// Білім PRO API (Netlify): деректер Netlify Blobs қоймасында сақталады.
import { getStore } from '@netlify/blobs';
import { handleRequest } from '../../server/http.mjs';

function blobStore() {
  const store = getStore({ name: 'bilim-pro', consistency: 'strong' });
  return {
    get: key => store.get(key, { type: 'json' }),
    set: (key, value) => store.setJSON(key, value),
    del: key => store.delete(key),
    list: async prefix => (await store.list({ prefix })).blobs.map(b => b.key)
  };
}

export default (req, context) => handleRequest(req, blobStore(), {
  ip: context.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown',
  secret: process.env.BILIM_SECRET
});

export const config = { path: '/api/*' };

import handler from '../server/handlers/media-gallery.js';

const req = {
  method: 'GET',
  query: { userId: 'guest-12345', type: 'artifact' },
  headers: {}
};
const res = {
  setHeader: () => {},
  status: (c) => ({
    json: (d) => console.log('STATUS', c, 'COUNT:', d.items?.length, JSON.stringify(d.items, null, 2))
  })
};

await handler(req, res);

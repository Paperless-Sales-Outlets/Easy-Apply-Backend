import express from 'express';

const router = express.Router();

const SLT_API = 'https://apphub.mobitel.lk/mobitelint/mapis/slt-mobitel-unified-website/api/dynamic/banners/117/1';
const SLT_SITE = 'https://www.sltmobitel.lk';
// ponytail: single in-memory cache; signed video URLs expire, so keep TTL short
const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, items: [] };

const abs = (u) => (u ? encodeURI(`${SLT_SITE}/api/${u}`) : null);

/**
 * @route   GET /api/slt-banners
 * @desc    Home-page slider ads (images + videos) from sltmobitel.lk
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    if (Date.now() - cache.at > TTL_MS) {
      const r = await fetch(SLT_API, {
        headers: {
          'X-IBM-Client-Id': process.env.SLT_BANNER_CLIENT_ID || 'b899f1d22db24461303ff89c8c5721f8',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`SLT banners API ${r.status}`);
      const json = await r.json();
      const items = json?.data?.data?.banner_items || [];
      cache = {
        at: Date.now(),
        items: items.map((i) => {
          const isVideo = i.type === 'VID';
          const src = (u) => (isVideo ? abs(u) : u?.startsWith('http') ? u : `${SLT_SITE}/${u}`);
          return {
            type: isVideo ? 'video' : 'image',
            src: src(i.url),
            mobileSrc: src(i.mobileUrl) || src(i.url),
            title: i.title?.[0]?.text || '',
            description: i.description || '',
            link: i.link || i.buttons?.[0]?.link || null,
            buttonText: i.buttons?.[0]?.text || 'Explore',
          };
        }),
      };
    }
    res.json({ success: true, data: cache.items });
  } catch (err) {
    console.error('slt-banners:', err.message);
    // serve stale cache rather than an empty carousel
    res.json({ success: true, data: cache.items });
  }
});

export default router;

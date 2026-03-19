export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

const DAILY_LIMIT   = 3;
const AIRTABLE_BASE = 'appwr5pb1cU6KrmCo';
const USAGE_TABLE   = 'Usage Tracking';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const key = process.env.ANTHROPIC_API_KEY_VSME;
    return res.status(200).json({
      key_set: !!key,
      key_prefix: key ? key.substring(0, 18) + '...' : 'NOT SET',
      airtable_set: !!process.env.AIRTABLE_TOKEN,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress
           || 'unknown';
  const identifier = `vsme:${ip}`;
  const today = new Date().toISOString().slice(0, 10);
  const atBase = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;
  const atHeaders = {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const filter = encodeURIComponent(`AND({email}="${identifier}",{date}="${today}")`);
  const searchRes = await fetch(
    `${atBase}/${encodeURIComponent(USAGE_TABLE)}?filterByFormula=${filter}`,
    { headers: atHeaders }
  );
  const searchData = await searchRes.json();
  const existing = (searchData.records || [])[0] || null;
  const currentCount = existing ? (existing.fields.count || 0) : 0;

  if (currentCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: {
        message: `今日 VSME 分析次數（${DAILY_LIMIT} 次）已用完，請明天再試。如需不限次數使用，歡迎聯繫 ZC 顧問團隊。`
      }
    });
  }

  const { tool: _tool, ...bodyWithoutTool } = req.body;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY_VSME,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(bodyWithoutTool),
  });
  const data = await response.json();

  if (!data.error) {
    if (existing) {
      await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}/${existing.id}`, {
        method: 'PATCH',
        headers: atHeaders,
        body: JSON.stringify({ fields: { count: currentCount + 1 } }),
      });
    } else {
      await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}`, {
        method: 'POST',
        headers: atHeaders,
        body: JSON.stringify({
          records: [{ fields: { email: identifier, date: today, count: 1 } }]
        }),
      });
    }
    return res.status(200).json({
      ...data,
      _quota: {
        used: currentCount + 1,
        limit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - currentCount - 1,
      }
    });
  }

  return res.status(response.status).json(data);
}

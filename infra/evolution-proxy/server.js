const express = require('express');
const axios = require('axios');

const app = express();
const EVOLUTION_GO_URL = 'http://evolution-go:8080';
const GLOBAL_API_KEY = process.env.GLOBAL_API_KEY || '0fdef2ec34b1f60c89470b6d50ab845a246d13ac50b320bc';

const instanceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getInstance(instanceName) {
  const cached = instanceCache.get(instanceName);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached;
  
  try {
    const response = await axios.get(`${EVOLUTION_GO_URL}/instance/all`, {
      headers: { apikey: GLOBAL_API_KEY }
    });
    const instances = response.data.data || response.data;
    for (const inst of instances) {
      if (inst.name === instanceName && inst.token && inst.id) {
        const entry = { token: inst.token, id: inst.id, timestamp: Date.now() };
        instanceCache.set(instanceName, entry);
        return entry;
      }
    }
  } catch (err) {
    console.error('Erro ao buscar instância:', err.message);
  }
  return null;
}

app.use(express.raw({ type: '*/*' }));

app.use(async (req, res) => {
  const path = req.path;
  console.log(`\n[Proxy] === ${req.method} ${path} ===`);
  
  const needsInstanceToken = 
    path.includes('/instance/connect') ||
    path.includes('/instance/qr') ||
    path.includes('/instance/disconnect') ||
    path.includes('/instance/logout') ||
    path.includes('/instance/reconnect') ||
    path.includes('/instance/forcereconnect') ||
    path.includes('/instance/settings') ||
    path.includes('/instance/proxy') ||
    path.includes('/instance/pair') ||
    path.includes('/instance/advanced-settings');
  
  // Headers limpos pra Evolution Go
  let headers = {
    'apikey': req.headers.apikey || GLOBAL_API_KEY,
    'content-type': req.headers['content-type'] || 'application/json',
  };
  
  
  if (needsInstanceToken) {
    let instanceName = null;
    
    if (req.query.instance) {
      instanceName = req.query.instance;
    }
    
    if (!instanceName) {
      const pathMatch = path.match(/\/instance\/(?:delete|info)\/(.+)/);
      if (pathMatch) instanceName = decodeURIComponent(pathMatch[1]);
    }
    
    if (!instanceName && req.body && req.body.length > 0) {
      try {
        const body = JSON.parse(req.body.toString());
        if (body.instance) instanceName = body.instance;
      } catch {}
    }
    
    if (!instanceName && req.headers.instanceid) {
      try {
        const response = await axios.get(`${EVOLUTION_GO_URL}/instance/all`, {
          headers: { apikey: GLOBAL_API_KEY }
        });
        const instances = response.data.data || response.data;
        for (const inst of instances) {
          if (inst.id === req.headers.instanceid && inst.name) {
            instanceName = inst.name;
            break;
          }
        }
      } catch {}
    }
    
    if (instanceName) {
      const instance = await getInstance(instanceName);
      if (instance) {
        headers.apikey = instance.token;
        headers.instanceid = instance.id;
        console.log('[Proxy] Token trocado para:', instanceName);
        console.log('[Proxy] instanceid:', headers.instanceid);
      } else {
        console.log('[Proxy] Instância não encontrada:', instanceName);
      }
    } else {
      console.log('[Proxy] Nome da instância não encontrado no request');
    }
  }
  
  console.log('[Proxy] Headers finais:', JSON.stringify(headers));
  
  try {
    const response = await axios({
      method: req.method,
      url: `${EVOLUTION_GO_URL}${path}`,
      headers,
      params: req.query,
      data: req.body && req.body.length > 0 ? req.body : undefined,
      responseType: 'arraybuffer',
      validateStatus: () => true, // Não lançar erro em qualquer status
    });
    
    console.log('[Proxy] Response status:', response.status);
    
    Object.keys(response.headers).forEach(key => {
      if (!['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });
    
    res.status(response.status).send(response.data);
  } catch (err) {
    console.error('[Proxy] Erro:', err.message);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`[Evolution Proxy] Rodando na porta ${PORT}`);
});

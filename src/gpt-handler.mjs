import { timingSafeEqual } from 'node:crypto';
import { MAX_RESPONSE_BYTES } from './core.mjs';

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(data));
}

async function parseBody(request, limit = 16384) {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error('Tipo de conteúdo deve ser application/json.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Corpo da requisição excede o limite permitido (16 KB).');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Corpo da requisição deve ser um objeto JSON.');
    }
    return data;
  } catch (err) {
    if (err.message.includes('Corpo da requisição')) throw err;
    throw new Error('Formato JSON inválido.');
  }
}

export function buildOpenApiSpec(baseUrl = 'http://127.0.0.1:59406') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'WhatsApp Manutenção — Leitura Segura',
      description: 'API somente leitura para consulta de conversas e mensagens previamente autorizadas no WhatsApp Manutenção.',
      version: '0.3.0'
    },
    servers: [
      {
        url: baseUrl,
        description: 'Servidor Seguro do WhatsApp Manutenção'
      }
    ],
    security: [
      {
        BearerAuth: []
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Insira o token de autenticação gerado pelo WhatsApp Manutenção.'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Mensagem explicativa do erro.' },
            code: { type: 'string', description: 'Código do erro.' }
          },
          required: ['error']
        },
        StatusResponse: {
          type: 'object',
          properties: {
            connected: { type: 'boolean', description: 'Indica se a conta WhatsApp está conectada.' },
            state: { type: 'string', description: 'Estado atual da conexão (ready, blocked, pairing).' },
            read_only: { type: 'boolean', description: 'Indica que a API opera estritamente em modo de leitura.' },
            chat_scope: { type: 'string', description: 'Escopo de conversas (local_allowlist).' },
            access_enabled: { type: 'boolean', description: 'Indica se há conversas autorizadas configuradas.' },
            allowed_chat_count: { type: 'integer', description: 'Quantidade de conversas autorizadas pelo usuário.' }
          },
          required: ['connected', 'state', 'read_only', 'access_enabled', 'allowed_chat_count']
        },
        Chat: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador seguro da conversa.' },
            name: { type: 'string', description: 'Nome do contato ou grupo.' },
            is_group: { type: 'boolean', description: 'Indica se a conversa é um grupo.' },
            unread_count: { type: 'integer', description: 'Quantidade de mensagens não lidas.' },
            last_activity: { type: 'string', format: 'date-time', nullable: true, description: 'Data/hora da última atividade.' }
          },
          required: ['chat_id', 'name', 'is_group', 'unread_count']
        },
        ChatsResponse: {
          type: 'object',
          properties: {
            chats: {
              type: 'array',
              items: { $ref: '#/components/schemas/Chat' },
              description: 'Lista de conversas autorizadas na allowlist.'
            },
            total_matching: { type: 'integer', description: 'Total de conversas autorizadas correspondentes.' },
            next_offset: { type: 'integer', nullable: true, description: 'Cursor para a próxima página.' },
            retrieved_at: { type: 'string', format: 'date-time', description: 'Timestamp da consulta.' }
          },
          required: ['chats', 'total_matching', 'retrieved_at']
        },
        ReadMessagesRequest: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa autorizada para ler mensagens.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Quantidade de mensagens mais recentes (máx 50).' },
            since: { type: 'string', format: 'date-time', description: 'Filtrar mensagens a partir desta data/hora UTC (inclusive).' },
            before: { type: 'string', format: 'date-time', description: 'Filtrar mensagens anteriores a esta data/hora UTC (exclusive).' }
          },
          required: ['chat_id']
        },
        Message: {
          type: 'object',
          properties: {
            message_id: { type: 'string', description: 'Identificador único da mensagem.' },
            timestamp: { type: 'string', format: 'date-time', description: 'Data/hora de envio.' },
            author: { type: 'string', description: 'Pseudônimo ou nome do autor (nunca expõe número de telefone).' },
            text: { type: 'string', description: 'Conteúdo textual da mensagem.' },
            truncated: { type: 'boolean', description: 'Indica se o texto foi cortado por limite de tamanho.' }
          },
          required: ['message_id', 'timestamp', 'author', 'text']
        },
        ReadMessagesResponse: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa consultada.' },
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/Message' },
              description: 'Mensagens retornadas em ordem cronológica.'
            },
            retrieved_count: { type: 'integer', description: 'Quantidade de mensagens retornadas nesta consulta.' },
            has_more: { type: 'boolean', description: 'Indica se há mais mensagens no período especificado.' },
            disclaimer: { type: 'string', description: 'Aviso sobre a natureza dos dados externos não confiáveis.' }
          },
          required: ['chat_id', 'messages', 'retrieved_count']
        },
        SearchMessagesRequest: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 100, description: 'Termo de busca (mínimo 2 caracteres).' },
            chat_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Opcional: restringir busca a IDs específicos de conversas autorizadas.'
            },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Limite de resultados.' }
          },
          required: ['query']
        },
        SearchResultItem: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa onde a mensagem foi encontrada.' },
            message_id: { type: 'string', description: 'Identificador da mensagem.' },
            timestamp: { type: 'string', format: 'date-time', description: 'Data/hora da mensagem.' },
            author: { type: 'string', description: 'Pseudônimo ou nome do autor.' },
            text: { type: 'string', description: 'Conteúdo textual da mensagem correspondente.' },
            truncated: { type: 'boolean', description: 'Indica se o texto foi cortado.' }
          },
          required: ['chat_id', 'message_id', 'timestamp', 'author', 'text']
        },
        SearchMessagesResponse: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Termo buscado.' },
            results: {
              type: 'array',
              items: { $ref: '#/components/schemas/SearchResultItem' },
              description: 'Mensagens encontradas correspondentes à busca.'
            },
            total_matching: { type: 'integer', description: 'Total de mensagens correspondentes encontradas.' },
            coverage: { type: 'string', description: 'Descrição da cobertura da busca.' },
            disclaimer: { type: 'string', description: 'Aviso de segurança.' }
          },
          required: ['query', 'results', 'total_matching']
        }
      }
    },
    paths: {
      '/gpt/status': {
        get: {
          operationId: 'getWhatsAppStatus',
          summary: 'Verifica o status da conexão WhatsApp',
          description: 'Consulta se a conta WhatsApp está conectada e quantas conversas estão autorizadas para leitura.',
          responses: {
            '200': {
              description: 'Status atual da conexão.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StatusResponse' }
                }
              }
            },
            '401': {
              description: 'Não autorizado (token inválido ou ausente).',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/gpt/chats': {
        get: {
          operationId: 'listAuthorizedChats',
          summary: 'Lista as conversas autorizadas pelo usuário',
          description: 'Retorna a lista de conversas que foram autorizadas pelo usuário no WhatsApp Manutenção.',
          parameters: [
            {
              name: 'query',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Opcional: filtrar conversas por nome.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
              description: 'Limite de conversas por página.'
            },
            {
              name: 'offset',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 0, default: 0 },
              description: 'Deslocamento de paginação.'
            }
          ],
          responses: {
            '200': {
              description: 'Lista de conversas autorizadas.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ChatsResponse' }
                }
              }
            },
            '401': {
              description: 'Não autorizado.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/gpt/messages': {
        post: {
          operationId: 'readAuthorizedMessages',
          summary: 'Lê mensagens de uma conversa autorizada',
          description: 'Consulta as mensagens mais recentes de uma conversa específica permitida na allowlist.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReadMessagesRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Mensagens retornadas com sucesso.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadMessagesResponse' }
                }
              }
            },
            '400': {
              description: 'Parâmetros inválidos.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            '401': {
              description: 'Não autorizado.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            '403': {
              description: 'Acesso negado: a conversa não está autorizada.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/gpt/search': {
        post: {
          operationId: 'searchAuthorizedMessages',
          summary: 'Pesquisa mensagens nas conversas autorizadas',
          description: 'Busca termos de texto dentro das mensagens das conversas autorizadas pelo usuário.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SearchMessagesRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Resultados da pesquisa.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchMessagesResponse' }
                }
              }
            },
            '400': {
              description: 'Parâmetros de busca inválidos.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            '401': {
              description: 'Não autorizado.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      }
    }
  };
}

export function createGptHandler({ getReader, getGptToken, getPublicUrl = () => 'http://127.0.0.1' }) {
  return async (request, response, parsedUrl) => {
    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
        'Content-Length': '0'
      });
      response.end();
      return true;
    }

    const pathname = parsedUrl.pathname;

    // 2. Servir OpenAPI Schema (pode ser público para o ChatGPT ler ao configurar a Action)
    if (pathname === '/gpt/openapi.json' && request.method === 'GET') {
      const publicBase = getPublicUrl() || `http://${request.headers.host}`;
      sendJson(response, 200, buildOpenApiSpec(publicBase));
      return true;
    }

    // 3. Validação de Autenticação Bearer Token
    const expectedToken = getGptToken();
    if (!expectedToken) {
      sendJson(response, 503, { error: 'O acesso remoto para Custom GPT ainda não foi configurado.' });
      return true;
    }

    const authHeader = request.headers.authorization ?? '';
    const match = /^Bearer\s+([a-f0-9]{32,128})$/i.exec(authHeader);
    if (!match || !equal(match[1], expectedToken)) {
      sendJson(response, 401, {
        error: 'Autenticação necessária. Forneça o token correto no cabeçalho Authorization: Bearer <token>.',
        code: 'UNAUTHORIZED'
      });
      return true;
    }

    // 4. Executar rotas protegidas
    const reader = getReader();
    if (!reader) {
      sendJson(response, 503, { error: 'Serviço WhatsApp não inicializado.', code: 'SERVICE_UNAVAILABLE' });
      return true;
    }

    try {
      if (pathname === '/gpt/status' && request.method === 'GET') {
        const result = await reader.execute('get_status', {});
        sendJson(response, 200, result);
        return true;
      }

      if (pathname === '/gpt/chats' && request.method === 'GET') {
        const query = parsedUrl.searchParams.get('query') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const offsetStr = parsedUrl.searchParams.get('offset');
        const limit = limitStr ? parseInt(limitStr, 10) : 30;
        const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
        const args = { limit: Math.min(Math.max(limit, 1), 50), offset: Math.max(offset, 0) };
        if (query) args.query = query;
        const result = await reader.execute('list_chats', args);
        sendJson(response, 200, result);
        return true;
      }

      if (pathname === '/gpt/messages' && request.method === 'POST') {
        const input = await parseBody(request);
        if (!input.chat_id || typeof input.chat_id !== 'string') {
          sendJson(response, 400, { error: 'O campo chat_id é obrigatório e deve ser uma string.', code: 'INVALID_ARGUMENT' });
          return true;
        }
        const args = {
          chat_id: input.chat_id,
          limit: typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 50) : 20
        };
        if (input.since) args.since = input.since;
        if (input.before) args.before = input.before;
        const result = await reader.execute('read_messages', args);
        sendJson(response, 200, { chat_id: input.chat_id, ...result });
        return true;
      }

      if (pathname === '/gpt/search' && request.method === 'POST') {
        const input = await parseBody(request);
        if (!input.query || typeof input.query !== 'string' || input.query.trim().length < 2) {
          sendJson(response, 400, { error: 'O campo query é obrigatório e deve conter pelo menos 2 caracteres.', code: 'INVALID_ARGUMENT' });
          return true;
        }
        const args = {
          query: input.query.trim(),
          limit: typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 50) : 20
        };
        if (Array.isArray(input.chat_ids) && input.chat_ids.length > 0) {
          args.chat_ids = input.chat_ids.filter(id => typeof id === 'string').slice(0, 3);
        } else {
          const policy = reader.access.snapshot(reader.provider.accountId());
          if (policy?.allowed_chat_ids && policy.allowed_chat_ids.length > 0) {
            args.chat_ids = policy.allowed_chat_ids.slice(0, 3);
          }
        }
        const result = await reader.execute('search_messages', args);
        sendJson(response, 200, {
          query: input.query,
          results: result.messages,
          ...result
        });
        return true;
      }

      sendJson(response, 404, { error: 'Endpoint não encontrado.', code: 'NOT_FOUND' });
      return true;
    } catch (err) {
      const isForbidden = err.code === 'ACCESS_NOT_CONFIGURED' || err.code === 'FORBIDDEN' || err.code === 'CHAT_NOT_ALLOWED';
      const isRateLimit = err.code === 'RATE_LIMITED' || err.code === 'BUSY';
      const status = isForbidden ? 403 : isRateLimit ? 429 : 400;
      sendJson(response, status, {
        error: err.message || 'Falha ao processar consulta.',
        code: err.code || 'ERROR'
      });
      return true;
    }
  };
}

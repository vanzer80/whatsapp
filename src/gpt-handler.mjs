import { timingSafeEqual } from 'node:crypto';
import { MAX_RESPONSE_BYTES, ReadError } from './core.mjs';

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function sendJson(response, statusCode, data, headers = {}) {
  let bodyStr = JSON.stringify(data);
  if (Buffer.byteLength(bodyStr, 'utf8') > MAX_RESPONSE_BYTES) {
    if (typeof data?.error === 'string') {
      const maxMsgBytes = MAX_RESPONSE_BYTES - 200;
      const truncatedError = Buffer.from(data.error, 'utf8').subarray(0, maxMsgBytes).toString('utf8');
      bodyStr = JSON.stringify({ ...data, error: truncatedError, truncated: true });
    }
  }
  const payloadBuf = Buffer.from(bodyStr, 'utf8');
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payloadBuf.length),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(payloadBuf);
}

export const SAFE_PUBLIC_ERRORS = {
  ACCESS_NOT_CONFIGURED: { status: 403, error: 'Nenhuma conversa autorizada para esta conta.' },
  ACCESS_REVOKED: { status: 403, error: 'A autorização local mudou. Esta resposta foi descartada.' },
  WRITE_SCOPE_REQUIRED: { status: 403, error: 'Esta operação de escrita não foi autorizada localmente.' },
  IDEMPOTENCY_CONFLICT: { status: 409, error: 'A chave de idempotência já foi usada com outros parâmetros.' },
  IDEMPOTENCY_PENDING: { status: 409, error: 'Existe uma operação anterior com resultado indeterminado para esta chave. Verifique antes de repetir.' },
  WRITE_RATE_LIMITED: { status: 429, error: 'Limite de operações de escrita atingido. Aguarde antes de tentar novamente.' },
  WRITE_STATE_INVALID: { status: 503, error: 'O estado local de proteção das operações de escrita precisa de atenção.' },
  WRITE_AUDIT_UNAVAILABLE: { status: 503, error: 'A auditoria local de escrita está indisponível.' },
  INVALID_WRITE_ARGUMENTS: { status: 400, error: 'Confira os IDs, os limites e os campos da operação.' },
  WRITE_FAILED: { status: 502, error: 'O WhatsApp não confirmou a operação de escrita.' },
  CHAT_NOT_ALLOWED: { status: 403, error: 'Conversa fora da lista local de acesso.' },
  FORBIDDEN: { status: 403, error: 'Acesso negado.' },
  RATE_LIMITED: { status: 429, error: 'Aguarde alguns segundos antes da próxima consulta.' },
  BUSY: { status: 429, error: 'Uma consulta já está em andamento. Aguarde sua conclusão.' },
  NOT_CONNECTED: { status: 503, error: 'Abra o aplicativo WhatsApp Manutenção e conecte seu WhatsApp.' },
  SERVICE_UNAVAILABLE: { status: 503, error: 'Serviço WhatsApp não inicializado.' },
  UNAUTHORIZED: { status: 401, error: 'Autenticação necessária. Forneça o token correto no cabeçalho Authorization: Bearer <token>.' },
  INVALID_ARGUMENTS: { status: 400, error: 'Confira os IDs, os limites e as datas com fuso horário.' },
  INVALID_ARGUMENT: { status: 400, error: 'Parâmetros de consulta inválidos.' },
  INVALID_RANGE: { status: 400, error: 'O início deve ser anterior ao fim.' },
  PAYLOAD_TOO_LARGE: { status: 400, error: 'Corpo da requisição excede o limite permitido (16 KB).' },
  RESPONSE_TOO_LARGE: { status: 400, error: 'A resposta excede o limite de dados. Reduza a consulta.' },
  UNKNOWN_TOOL: { status: 400, error: 'Ferramenta indisponível. Este plugin oferece somente consultas.' },
  NOT_FOUND: { status: 404, error: 'Endpoint não encontrado.' }
};

async function parseBody(request, limit = 16384) {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new ReadError('INVALID_ARGUMENT', 'Tipo de conteúdo deve ser application/json.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new ReadError('PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite permitido (16 KB).');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ReadError('INVALID_ARGUMENT', 'Corpo da requisição deve ser um objeto JSON.');
    }
    return data;
  } catch (err) {
    if (err instanceof ReadError) throw err;
    throw new ReadError('INVALID_ARGUMENT', 'Formato JSON inválido.');
  }
}

export function buildOpenApiSpec(baseUrl = 'https://tunnel.trycloudflare.com') {
  const spec = {
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
            last_activity: {
              anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
              description: 'Data/hora da última atividade.'
            }
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
            next_offset: {
              type: ['integer', 'null'],
              description: 'Cursor para a próxima página.'
            },
            retrieved_at: { type: 'string', format: 'date-time', description: 'Timestamp da consulta.' }
          },
          required: ['chats', 'total_matching', 'retrieved_at']
        },
        ReadMessagesRequest: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa autorizada para ler mensagens.' },
            limit: { type: 'integer', minimum: 1, maximum: 30, default: 20, description: 'Quantidade de mensagens mais recentes (máx 30).' },
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
            author: {
              type: ['string', 'null'],
              description: 'Pseudônimo ou nome do autor (nunca expõe número de telefone).'
            },
            text: { type: 'string', description: 'Conteúdo textual da mensagem.' },
            truncated: { type: 'boolean', description: 'Indica se o texto foi cortado por limite de tamanho.' },
            text_truncated: { type: 'boolean', description: 'Alias para conformidade com o formato do leitor.' }
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
            limit: { type: 'integer', minimum: 1, maximum: 30, default: 20, description: 'Limite de resultados.' }
          },
          required: ['query']
        },
        SearchResultItem: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa onde a mensagem foi encontrada.' },
            message_id: { type: 'string', description: 'Identificador da mensagem.' },
            timestamp: { type: 'string', format: 'date-time', description: 'Data/hora da mensagem.' },
            author: {
              type: ['string', 'null'],
              description: 'Pseudônimo ou nome do autor.'
            },
            text: { type: 'string', description: 'Conteúdo textual da mensagem correspondente.' },
            truncated: { type: 'boolean', description: 'Indica se o texto foi cortado.' },
            text_truncated: { type: 'boolean', description: 'Indica se o texto foi cortado.' }
          },
          required: ['chat_id', 'message_id', 'timestamp', 'author', 'text']
        },
        CoverageItem: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Identificador da conversa examinada.' },
            scanned_count: { type: 'integer', description: 'Total de mensagens examinadas nesta conversa.' },
            requested_scan_limit: { type: 'integer', description: 'Limite de varredura configurado.' },
            oldest_scanned: {
              anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
              description: 'Data da mensagem mais antiga examinada.'
            },
            newest_scanned: {
              anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
              description: 'Data da mensagem mais recente examinada.'
            },
            complete_history: { type: 'boolean', description: 'Indica se todo o histórico foi coberto.' }
          },
          required: ['chat_id', 'scanned_count', 'complete_history']
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
            returned_count: { type: 'integer', description: 'Quantidade de mensagens retornadas nesta consulta.' },
            has_more: { type: 'boolean', description: 'Indica se há mais mensagens correspondentes que excederam o limite ou o orçamento.' },
            coverage: {
              type: 'array',
              items: { $ref: '#/components/schemas/CoverageItem' },
              description: 'Lista detalhada de conversas e janelas examinadas.'
            },
            disclaimer: { type: 'string', description: 'Aviso de segurança sobre os resultados.' }
          },
          required: ['query', 'results', 'total_matching', 'returned_count']
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
              schema: { type: 'integer', minimum: 1, maximum: 30, default: 30 },
              description: 'Limite de conversas por página (máx 30).'
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
            },
            '403': {
              description: 'Acesso negado: conversa não autorizada informada.',
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
  spec.info.title = 'WhatsApp Manutenção — Leitura e Escrita Controlada';
  spec.info.description = 'API para leitura e operações de escrita com allowlist, scopes locais e idempotência.';
  Object.assign(spec.components.schemas, {
    SendMessageRequest:{type:'object',additionalProperties:false,properties:{chat_id:{type:'string'},text:{type:'string',minLength:1,maxLength:4096},idempotency_key:{type:'string',minLength:8,maxLength:128}},required:['chat_id','text','idempotency_key']},
    CreateGroupRequest:{type:'object',additionalProperties:false,properties:{name:{type:'string',minLength:1,maxLength:100},participant_ids:{type:'array',minItems:1,maxItems:30,items:{type:'string'}},idempotency_key:{type:'string',minLength:8,maxLength:128}},required:['name','participant_ids','idempotency_key']},
    UpdateGroupRequest:{type:'object',additionalProperties:false,properties:{chat_id:{type:'string'},subject:{type:'string',minLength:1,maxLength:100},description:{type:'string',maxLength:512},messages_admins_only:{type:'boolean'},info_admins_only:{type:'boolean'},idempotency_key:{type:'string',minLength:8,maxLength:128}},required:['chat_id','idempotency_key']},
    ManageGroupParticipantsRequest:{type:'object',additionalProperties:false,properties:{chat_id:{type:'string'},action:{type:'string',enum:['add','remove','promote','demote']},participant_ids:{type:'array',minItems:1,maxItems:30,items:{type:'string'}},idempotency_key:{type:'string',minLength:8,maxLength:128}},required:['chat_id','action','participant_ids','idempotency_key']},
    WriteResult:{type:'object',properties:{ok:{type:'boolean'},chat_id:{type:['string','null']},group_id:{type:['string','null']},message_id:{type:['string','null']}},required:['ok']}
  });
  const writePath=(operationId,summary,schema)=>({post:{operationId,summary,requestBody:{required:true,content:{'application/json':{schema:{$ref:`#/components/schemas/${schema}`}}}},responses:{'200':{description:'Operação concluída.',content:{'application/json':{schema:{$ref:'#/components/schemas/WriteResult'}}}},'400':{description:'Entrada inválida.',content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorResponse'}}}},'403':{description:'Escopo ou conversa não autorizada.',content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorResponse'}}}},'409':{description:'Conflito de idempotência.',content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorResponse'}}}}}}});
  spec.paths['/gpt/send']=writePath('sendWhatsAppMessage','Envia mensagem para conversa autorizada','SendMessageRequest');
  spec.paths['/gpt/groups/create']=writePath('createWhatsAppGroup','Cria grupo com autorização específica','CreateGroupRequest');
  spec.paths['/gpt/groups/update']=writePath('updateWhatsAppGroup','Altera grupo autorizado','UpdateGroupRequest');
  spec.paths['/gpt/groups/participants']=writePath('manageWhatsAppGroupParticipants','Gerencia participantes do grupo autorizado','ManageGroupParticipantsRequest');
  return spec;
}

export function createGptHandler({ getReader, getWriter = () => null, getGptToken, getPublicUrl = () => null, onExternalQuery = () => {} }) {
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

    // 2. Servir OpenAPI Schema (público para importação pelo ChatGPT Actions)
    if (pathname === '/gpt/openapi.json' && request.method === 'GET') {
      const publicBase = getPublicUrl() || 'https://desconectado.whatsapp-manutencao.local';
      sendJson(response, 200, buildOpenApiSpec(publicBase));
      return true;
    }

    // 3. Validação de Autenticação Bearer Token
    const expectedToken = getGptToken();
    if (!expectedToken) {
      sendJson(response, 503, { error: 'O acesso remoto para Custom GPT ainda não foi configurado.', code: 'SERVICE_UNAVAILABLE' });
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
      function assertPolicyCurrent(initialPolicy, initialAccountId) {
        if (!initialPolicy || !reader.access.unchanged(initialPolicy, initialAccountId)) {
          throw new ReadError('ACCESS_REVOKED', 'A autorização local mudou. Esta resposta foi descartada.');
        }
      }

      if (pathname === '/gpt/status' && request.method === 'GET') {
        const result = await reader.execute('get_status', {});
        onExternalQuery();
        sendJson(response, 200, result);
        return true;
      }

      if (pathname === '/gpt/chats' && request.method === 'GET') {
        const query = parsedUrl.searchParams.get('query') || undefined;
        if (query !== undefined && (typeof query !== 'string' || query.length > 200)) {
          throw new ReadError('INVALID_ARGUMENT', 'O parâmetro query excede o tamanho permitido.');
        }
        const limitStr = parsedUrl.searchParams.get('limit');
        let limit = 30;
        if (limitStr !== null) {
          if (!/^\d+$/.test(limitStr)) throw new ReadError('INVALID_ARGUMENT', 'O parâmetro limit deve ser um número inteiro.');
          limit = parseInt(limitStr, 10);
          if (limit < 1 || limit > 30) throw new ReadError('INVALID_ARGUMENT', 'O parâmetro limit deve estar entre 1 e 30.');
        }
        const offsetStr = parsedUrl.searchParams.get('offset');
        let offset = 0;
        if (offsetStr !== null) {
          if (!/^\d+$/.test(offsetStr)) throw new ReadError('INVALID_ARGUMENT', 'O parâmetro offset deve ser um número inteiro.');
          offset = parseInt(offsetStr, 10);
          if (offset < 0) throw new ReadError('INVALID_ARGUMENT', 'O parâmetro offset é inválido.');
        }

        const initialAccountId = reader.provider.accountId();
        const initialPolicy = reader.access.snapshot(initialAccountId);
        if (!initialPolicy) {
          throw new ReadError('ACCESS_NOT_CONFIGURED', 'Nenhuma conversa autorizada para esta conta.');
        }
        assertPolicyCurrent(initialPolicy, initialAccountId);

        const args = { limit, offset };
        if (query) args.query = query;
        const result = await reader.execute('list_chats', args);
        assertPolicyCurrent(initialPolicy, initialAccountId);

        onExternalQuery();
        sendJson(response, 200, result);
        return true;
      }

      if (pathname === '/gpt/messages' && request.method === 'POST') {
        const input = await parseBody(request);
        if (!input.chat_id || typeof input.chat_id !== 'string') {
          throw new ReadError('INVALID_ARGUMENT', 'O campo chat_id é obrigatório e deve ser uma string.');
        }
        let limit = 20;
        if (input.limit !== undefined) {
          if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 30) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo limit deve ser um número inteiro entre 1 e 30.');
          }
          limit = input.limit;
        }
        if (input.since !== undefined) {
          if (typeof input.since !== 'string' || isNaN(Date.parse(input.since))) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo since deve ser uma data válida no formato ISO 8601.');
          }
        }
        if (input.before !== undefined) {
          if (typeof input.before !== 'string' || isNaN(Date.parse(input.before))) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo before deve ser uma data válida no formato ISO 8601.');
          }
        }
        if (input.since && input.before && Date.parse(input.since) >= Date.parse(input.before)) {
          throw new ReadError('INVALID_RANGE', 'O início deve ser anterior ao fim.');
        }

        const initialAccountId = reader.provider.accountId();
        const initialPolicy = reader.access.snapshot(initialAccountId);
        if (!initialPolicy || !initialPolicy.allowed_chat_ids?.includes(input.chat_id)) {
          throw new ReadError('CHAT_NOT_ALLOWED', 'Conversa fora da lista local de acesso.');
        }
        assertPolicyCurrent(initialPolicy, initialAccountId);

        const args = { chat_id: input.chat_id, limit };
        if (input.since) args.since = input.since;
        if (input.before) args.before = input.before;
        const result = await reader.execute('read_messages', args);
        assertPolicyCurrent(initialPolicy, initialAccountId);

        const messages = (result.messages || []).map(m => ({
          ...m,
          author: m.author ?? null,
          truncated: Boolean(m.text_truncated)
        }));

        let responseData = {
          chat_id: input.chat_id,
          messages,
          retrieved_count: messages.length,
          has_more: Boolean(result.result_truncated),
          disclaimer: result.note || 'Janela recente e limitada nas conversas autorizadas.'
        };

        // Validação estrita do teto de bytes de resposta
        while (Buffer.byteLength(JSON.stringify(responseData), 'utf8') > MAX_RESPONSE_BYTES && responseData.messages.length) {
          responseData.messages.shift();
          responseData.has_more = true;
          responseData.retrieved_count = responseData.messages.length;
        }

        // Revalidação imediata antes de emitir a resposta final (F01)
        assertPolicyCurrent(initialPolicy, initialAccountId);

        onExternalQuery();
        sendJson(response, 200, responseData);
        return true;
      }

      if (pathname === '/gpt/search' && request.method === 'POST') {
        const input = await parseBody(request);
        if (!input.query || typeof input.query !== 'string' || input.query.trim().length < 2) {
          throw new ReadError('INVALID_ARGUMENT', 'O campo query é obrigatório e deve conter pelo menos 2 caracteres.');
        }
        if (input.query.length > 100) {
          throw new ReadError('INVALID_ARGUMENT', 'O campo query não pode exceder 100 caracteres.');
        }

        let requestedLimit = 20;
        if (input.limit !== undefined) {
          if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 30) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo limit deve ser um número inteiro entre 1 e 30.');
          }
          requestedLimit = input.limit;
        }
        if (input.since !== undefined) {
          if (typeof input.since !== 'string' || isNaN(Date.parse(input.since))) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo since deve ser uma data válida no formato ISO 8601.');
          }
        }
        if (input.before !== undefined) {
          if (typeof input.before !== 'string' || isNaN(Date.parse(input.before))) {
            throw new ReadError('INVALID_ARGUMENT', 'O campo before deve ser uma data válida no formato ISO 8601.');
          }
        }
        if (input.since && input.before && Date.parse(input.since) >= Date.parse(input.before)) {
          throw new ReadError('INVALID_RANGE', 'O início deve ser anterior ao fim.');
        }

        const initialAccountId = reader.provider.accountId();
        const initialPolicy = reader.access.snapshot(initialAccountId);
        if (!initialPolicy || !initialPolicy.allowed_chat_ids?.length) {
          throw new ReadError('ACCESS_NOT_CONFIGURED', 'Nenhuma conversa autorizada para esta conta.');
        }

        let targetChatIds;
        if (Array.isArray(input.chat_ids) && input.chat_ids.length > 0) {
          const invalid = input.chat_ids.find(id => typeof id !== 'string' || !initialPolicy.allowed_chat_ids.includes(id));
          if (invalid) {
            throw new ReadError('CHAT_NOT_ALLOWED', `Conversa fora da lista local de acesso: ${invalid}`);
          }
          targetChatIds = [...new Set(input.chat_ids)];
        } else {
          targetChatIds = [...initialPolicy.allowed_chat_ids];
        }

        assertPolicyCurrent(initialPolicy, initialAccountId);

        // Uma única unidade de execução lógica em Reader.execute para a busca completa (F02)
        const searchArgs = {
          query: input.query.trim(),
          chat_ids: targetChatIds,
          limit: requestedLimit
        };
        if (input.since) searchArgs.since = input.since;
        if (input.before) searchArgs.before = input.before;

        const result = await reader.execute('search_messages', searchArgs);
        assertPolicyCurrent(initialPolicy, initialAccountId);

        const rawMessages = result.messages || [];
        const finalResults = rawMessages.map(m => ({
          ...m,
          author: m.author ?? null,
          truncated: Boolean(m.text_truncated)
        }));

        let responseData = {
          query: input.query.trim(),
          results: finalResults,
          total_matching: result.matching_in_scanned_window ?? finalResults.length,
          returned_count: finalResults.length,
          has_more: Boolean(result.result_truncated),
          coverage: result.coverage || [],
          disclaimer: result.note || 'Janela recente e limitada nas conversas autorizadas.'
        };

        // Validação estrita do teto de bytes preservando total_matching (F04 e F05)
        while (Buffer.byteLength(JSON.stringify(responseData), 'utf8') > MAX_RESPONSE_BYTES && responseData.results.length) {
          responseData.results.shift();
          responseData.returned_count = responseData.results.length;
          responseData.has_more = true;
        }

        // Revalidação imediata antes de emitir resposta final (F01)
        assertPolicyCurrent(initialPolicy, initialAccountId);

        onExternalQuery();
        sendJson(response, 200, responseData);
        return true;
      }

      const writeRoute = {
        '/gpt/send':'send_message',
        '/gpt/groups/create':'create_group',
        '/gpt/groups/update':'update_group',
        '/gpt/groups/participants':'manage_group_participants'
      }[pathname];
      if (writeRoute && request.method === 'POST') {
        const writer=getWriter();
        if (!writer) throw new ReadError('SERVICE_UNAVAILABLE', 'Serviço de escrita não inicializado.');
        const input=await parseBody(request);
        const result=await writer.execute(writeRoute,input);
        onExternalQuery();
        sendJson(response,200,result);
        return true;
      }

      sendJson(response, 404, { error: 'Endpoint não encontrado.', code: 'NOT_FOUND' });
      return true;
    } catch (err) {
      let code = typeof err?.code === 'string' && SAFE_PUBLIC_ERRORS[err.code] ? err.code : 'ERROR';
      let entry = SAFE_PUBLIC_ERRORS[code];
      let status = entry ? entry.status : 500;
      let safeMsg = entry ? entry.error : 'Falha ao processar consulta.';
      if (err?.message && (code === 'INVALID_ARGUMENT' || code === 'INVALID_RANGE' || code === 'CHAT_NOT_ALLOWED')) {
        if (!/INTERNAL_MARKER|fake|\/|\\|node_modules|Error:|stack/i.test(err.message)) {
          safeMsg = err.message.slice(0, 300);
        }
      }
      sendJson(response, status, {
        error: safeMsg,
        code
      });
      return true;
    }
  };
}

# Proposal

## Why

O bot-template depende do Orgo oficial para o computador e suas telas. O usuário pediu substituir essa dependência pelo nosso Daytona privado e usar o próprio aplicativo como teste real da integração.

## What Changes

- Trocar o cliente Orgo fixo por uma integração backend com a API do Daytona, configurada por URL, chave privada e ID de sandbox existente.
- Preservar computador compartilhado, até quatro telas independentes por bot, screenshot, comandos, arquivos e viewer watch/control autenticado.
- Gerenciar somente displays/processos/arquivos pertencentes ao bot-template dentro do guest existente; o desktop original e seus dados permanecem preservados.
- Preparar implantação privada do HQ no próprio guest, com diretórios dedicados, suporte Hermes sem copiar credenciais globais e configuração opcional de xAI/Composio.
- Entregar prova real do computador pelo app, documentação de uso e limites observados de autenticação de modelos/provedores externos.
- **BREAKING:** a configuração padrão de computador passa de ORGO_API_KEY/ORGO_COMPUTER_ID para DAYTONA_API_URL/DAYTONA_API_KEY/DAYTONA_SANDBOX_ID. Não haverá fallback silencioso para o SaaS.

## Capabilities

### New Capabilities

- `private-computer`: seleção do desktop existente, telas próprias, transporte privado, comandos/arquivos e preservação dos recursos alheios.

### Modified Capabilities

Nenhuma: projeto sem specs canônicas anteriores.

## Impact

Backend Hono/TypeScript, scripts Python/shell de desktop, instalação/configuração, testes e documentação. O servidor HQ deve rodar no guest para preservar o gerenciamento local de Hermes e a Library existentes. UI permanece com os mesmos fluxos; ajustes de contrato/labels somente se necessários, sem redesenho. Sem mudança no core Daytona, novos sandboxes, produção9443, DNS público, credenciais compartilhadas ou integrações externas enviando mensagens.

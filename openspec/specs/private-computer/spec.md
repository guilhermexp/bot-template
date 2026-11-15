# private-computer Specification

## Purpose
Permitir que o Bot HQ use um computador Daytona privado já existente, preservando telas independentes dos bots, acesso autenticado e recursos de outros trabalhos no mesmo guest.

## Requirements

### Requirement: Computador privado existente
O sistema SHALL usar somente o sandbox configurado por URL, chave privada e ID, sem depender do Orgo oficial, criar outro computador ou iniciar/parar/excluir o existente automaticamente.

#### Scenario: Sandbox ligado
- **WHEN** a configuração é válida e o sandbox está ligado
- **THEN** o aplicativo reconhece o computador e permite usar suas telas próprias sem chamadas ao Orgo oficial.

#### Scenario: Sandbox indisponível
- **WHEN** a chave é inválida ou o sandbox está parado ou inacessível
- **THEN** o aplicativo informa erro recuperável, preserva configurações e não executa criação nem alteração de ciclo do sandbox.

### Requirement: Telas independentes pertencentes ao aplicativo
O sistema SHALL oferecer até quatro telas independentes para os bots, incluindo a primária do aplicativo, sem ocupar o desktop original ou encerrar processos de outra origem.

#### Scenario: Alocação e concorrência
- **WHEN** bots distintos solicitam telas, inclusive simultaneamente
- **THEN** recebem telas distintas ou erro explícito de capacidade, sem duplicar ownership ou ultrapassar quatro telas.

#### Scenario: Remoção e retorno
- **WHEN** um bot de teste é removido ou o HQ reinicia
- **THEN** apenas recursos comprovadamente pertencentes àquele bot são liberados ou reaproveitados, e o desktop original permanece funcionando.

### Requirement: Comandos e arquivos no computador selecionado
O sistema SHALL executar comandos com o display correto e transferir arquivos com resultados reais, erros e limites explícitos, preservando o isolamento de caminhos da Library.

#### Scenario: Shell e transferência reais
- **WHEN** um bot escreve e consulta um arquivo de teste em sua área
- **THEN** o conteúdo e o código de saída são preservados, e o download autenticado tem o mesmo hash.

#### Scenario: Caminho ou comando recusado
- **WHEN** o comando falha ou um download escapa da área autorizada
- **THEN** a operação não aparece como sucesso e o arquivo privado não é devolvido.

### Requirement: Captura e viewer por tela
O sistema SHALL fornecer screenshot e viewer da tela do bot correto, mantendo a chave Daytona e dados de acesso upstream no backend e autorizando a sessão do usuário antes de abrir o relay.

#### Scenario: Controle e observação
- **WHEN** o usuário autorizado abre a tela em watch ou control
- **THEN** ambos recebem imagem real da tela correta e somente control encaminha teclado, mouse e clipboard.

#### Scenario: Acesso não autorizado
- **WHEN** uma sessão ausente ou de outro usuário solicita captura, Library ou WebSocket de um bot
- **THEN** o servidor recusa o acesso sem iniciar viewer nem revelar credenciais ou URL upstream privada.

### Requirement: Instalação privada e preservação
A instalação SHALL manter dados, perfis e configurações em área dedicada, preservar o desktop original e permitir reversão dos recursos do aplicativo sem remover recursos de outros trabalhos.

#### Scenario: Instalar no guest existente
- **WHEN** o HQ é instalado para teste
- **THEN** o desktop original, arquivos conhecidos, usuários/quotas e outros sandboxes são preservados, e o app é acessível por transporte privado documentado.

### Requirement: Dependências externas explícitas
O sistema SHALL permitir testar o computador sem exigir chaves de xAI ou Composio e apresentar indisponibilidade explícita dos recursos não configurados, sem usar tokens fictícios ou copiar autenticação global.

#### Scenario: Apenas computador configurado
- **WHEN** Daytona está configurado e serviços opcionais não estão
- **THEN** login, bots, telas, shell e Library podem ser exercitados e os recursos externos retornam erro de configuração acionável.

#### Scenario: Autenticação Hermes ausente
- **WHEN** o Hermes dedicado ainda não tem um provedor de modelo autenticado
- **THEN** o app identifica essa dependência e não declara uma conversa real concluída.

# Design

## Context

O projeto em decf9a21 usa REST Orgo próprio (server/src/orgo.ts) e relay RFB com host Orgo fixo (vnc.ts). computer.ts aloca quatro screens, box.ts assume default:99 e demais screen-N; engine.ts depende de HQ_LOCAL para DISPLAY, browser e gerenciamento dos gateways. Scripts de desktop têm paths /opt/hq e /root/grokbot e efeitos globais de Chrome/GTK/processos, incompatíveis com preservação do guest atual.

Nosso Daytona já fornece estado do sandbox, toolbox process/execute e files, previews privados assinados e PNG/input do display global. Este último não seleciona display por request; portanto, não resolve as telas dos bots. A integração terá responsabilidade no consumidor, sem alterar o servidor Daytona.

## Goals / Non-Goals

**Goals:** adaptar o contrato de computador e manter as jornadas existentes, instalar o HQ no guest e deixar um teste privado real verificável.

**Non-Goals:** redesenho, migração geral do modelo de dados, novo sandbox, correção genérica do monorepo Daytona, produção9443, APIs públicas, copiar tokens de assinatura globais, testar ações externas de envio/compra/contato.

## Decisions

1. **Thin REST backend Daytona.** Configuração DAYTONA_API_URL/API_KEY/SANDBOX_ID, TLS verificado, timeout, erros sanitizados e sem fallback Orgo. getComputer mapeia started→running. ensureComputer verifica disponibilidade e não chama start/resume/suspend. Reusar campos internos orgo_id/orgoId temporariamente é compatibilidade de dados, não dependência SaaS.
2. **HQ e Hermes dedicado no guest.** Preserva FS/spawn, Library e login visual da arquitetura atual, evitando inventar um gerenciador remoto. Usar diretório exclusivo do bot-template; HERMES_HOME_PRIMARY dedicado quando não houver primário próprio. Nunca ler/copiar ~/.hermes ou credenciais do host. Chaves opcionais ficam ausentes e seus clientes são lazy/guardados, sem placeholders.
3. **Quatro telas próprias.** Helper Python/shell com registro e lock, alocação validada em displays100+ sem tocar:0/:99 existentes, portas próprias loopback, Xvfb/WM/x11vnc/websockify por tela. A tela default do app também é própria. Screen IDs/ordem permanecem coerentes na UI; display real vem do contrato central, sem derivação insegura de texto livre. Inicialização lazy para respeitar1GiB do guest existente; sem resize/quotas.
4. **Ownership verificável.** Diretórios, HOME/XDG, Chromeprofiles e processos exclusivos, identidade PID+starttime/comando e bounds de portas/display. Não instalar política Chrome global, alterar GTK original ou matar hq-shells de outras raízes. Somente recursos próprios podem ser encerrados em delete/reset. Preservar unidade inteira e definir restauração antes de qualquer substituição de configuração existente.
5. **Viewer backend.** Substituir URL/password Orgo por conexão websockify do helper; preservar cookie/ownBot, handshake e WatchFilter. Com HQ no guest, upstream loopback é suficiente; não publicar VNC/CDP. HTTP do HQ sai por preview Daytona privado retornado pela API. Qualquer URL assinada é opaca, temporal e fica em arquivo privado/servidor, nunca no bundle/log/Git. Sem desativar TLS/Dex.
6. **Exec/files/capture.** Adapter cobre API real de exec e arquivos; execução local já existente com HQ_LOCAL permanece dentro do mesmo guest e encaminha o DISPLAY correto. Captura por display próprio, nunca confundir PNG do desktop:0 com tela de bot. Downloads passam por autorização e realpath existente; negar traversal/symlink escape. Não criar export/storage público.
7. **Provar sem inventar credenciais.** TDD com fixtures HTTP locais para contratos e helper real quando viável. Prova final usa app real + no mínimo duas telas distintas, captura/exec/files/hash e RFB watch/control, negativas de sessão e preservação. Capacidade quatro e concorrência testadas também sem iniciar quatro Chromes pesados. Chat/voz/apps só ganham aprovação se credenciais reais e autorização existirem; ausência é limitação explícita, sem bloquear a prova do computador.

## Risks / Trade-offs

- Guest de1vCPU/1GiB → telas/chrome/gateways lazy, medir recursos; não alterar capacidade/quota nem matar vizinhos para passar teste.
- Instalação Hermes/desktop pode exigir pacotes → usar versões/fontes oficiais fixadas e área própria; preservação antes de config. Falta de sudo ou dependência é bloqueio concreto, não motivo para trocar destino silenciosamente.
- Modelo/provedores podem não estar autenticados → estado honesto e fluxo nativo de login; nenhum token inventado ou global importado.
- API key write:sandboxes possui acesso amplo → segredo somente backend0600; não é isolamento entre bots. App já compartilha o guest, isso permanece explícito.
- Preview expira → registrar TTL e comando seguro para renovação; não copiar URL assinada para fontes públicas.

## Migration Plan

Branch feat/private-computer sobre decf9a21 nos clones novos Mac/Box. Código e testes pelo Codex na agents-us; orquestrador revisa no Mac. Configuração real em .tmp/private ignorada. Registrar preflight do guest/stack e caminhos afetados antes de instalar. Implantar somente recursos bot-template, provar e deixar app/test desktop ligados; reversão encerra apenas recursos do app e preserva dados/credenciais. Commit final após review-pair --gate ou contingência manual completa com scanner; depois integração, archive, syncAGENTS/Brain e cleanup. Não há pipeline de publicação autorizado além do teste privado; conferir hooks/workflows antes de push.

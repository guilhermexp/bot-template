# Tasks

## 1. Contrato de computador e configuração

- [x] 1.1 Registrar baseline funcional de origem e bloqueios reais sem chamar o Orgo, com arquivos/rotas/fluxos e status honesto em FUNCTIONAL-BASELINE.html; validar JSON/contagens e atualizar o recorte afetado após prova real. Prova: `FUNCTIONAL-BASELINE.html` (origem decf9a21 estática, teto PARCIAL; recorte atualizado até a v7) e `.tmp/verify/use-private-computer-20261114-01/delivery-v1`…`v7`.
- [x] 1.2 Implementar transporte REST Daytona e configuração privada sem ORGO_API_KEY, com testes RED/GREEN para estado, exec/files, erros, timeout, segredo e ausência de lifecycle/fallback SaaS; documentar env e migração. Prova: suíte `npm run test:private-computer` (109 testes na v7, fail 0), GET do sandbox pela API pública devolvendo 200 de dentro do guest (v2), README/.env.example com migração (v4).
- [x] 1.3 Permitir boot sem xAI/Composio com clientes lazy e erros de recurso não configurado, verificando testes e mantendo credenciais ausentes sem placeholders. Prova: app no ar sem as chaves, testes de app com credenciais pré-carregadas e removidas (v7). Login Google via Composio ficou pendente da `COMPOSIO_API_KEY` do usuário (configuração, sem código).

## 2. Telas e recursos próprios

- [x] 2.1 Implementar registry/helper de quatro telas próprias lazy com display/portas/ownership e testes RED/GREEN de concorrência, colisão, capacidade e cleanup, sem tocar desktop original. Prova: `server/box/screen-registry.py` e testes Python; recovery real (Xvfb SIGKILL e VNC morto) com exit 0 na v7; Xauthority/VNC autenticados (v5).
- [x] 2.2 Integrar mapeamento default/ordem/display, lease, captura e criação/remoção de bot; testar duas telas distintas e falhas, mantendo noVNC/WatchFilter/autorização. Prova: `proof-v7__runtime.json` (telas 100/101, PNG 1024×768, RFB watch bloqueando e control encaminhando, negativas 401/403/404); Aside do orquestrador em `aside-root-v7/`.
- [x] 2.3 Confinar shell, Library, perfis e scripts a raiz própria e remover efeitos globais de políticas/GTK/pkill; testar transferência com hash, traversal e preservação de processo alheio; documentar reversão. Prova: save/list/download com hash e recusa de traversal/symlink no runtime; 11 identidades e 3 configurações Xfce do desktop original preservadas; reversão em `docs/private-computer.md`.

## 3. Instalação e prova integrada

- [x] 3.1 Preparar instalação HQ/Hermes dedicada no guest via API existente, com estado antes/depois, segredo0600, supervisão própria e preflight de ferramentas/recursos; preservar unidade inteira antes de mudanças e fornecer reversão verificável. Prova: raiz `/home/daytona/bot-template-private` (uid 1001), Hermes 0.21.5 da fonte oficial fixada, backups `config/before-turn*`, `private-service.py` com identidade verificada; desktop ampliado para 2 vCPU/4 GiB pelo resize do Daytona (commit `1a06ed9e` no repositório Daytona).
- [x] 3.2 Disponibilizar app em preview privado do sandbox existente, provar login, bots, screenshot, shell/Library e RFB watch/control com negativas de sessão; registrar TTL/renovação, processos/dados preservados e qualquer dependência real de autenticação Hermes. Prova: preview HTTPS/WSS PASS (`logs/preview-runtime.log` da v7), TTL 86400 s com renovação documentada, Aside do orquestrador pela URL pública em `.desk-e2e.dokploy-us.space`; Hermes sem modelo autenticado (dependência do usuário).
- [x] 3.3 Executar typecheck/build e testes focados/reais apropriados, revisão final review-pair --gate ou contingência manual com scanner e árvore exata; entregar recibos sanitizados, limites e arquivos alterados para aceite do orquestrador. Prova: cinco rodadas do `review-pair.sh --gate` (achados tratados nas v3–v7) e revisão manual final do orquestrador sobre a árvore `8ad6642e` com Gitleaks 0 achados: `.tmp/verify/use-private-computer-20261114-01/manual-review-v7/summary.md`. Não é exit 0 automático.

## Workflow follow-up

- Orquestrador aceita evidências, marca tarefas e arquiva com CLI OpenSpec, verificando specs canônicas.
- Orquestrador executa syncAGENTS/Brain e relê, integra código revisado na main/push sem force após conferir efeitos de CI.
- Cleanup da branch/checkouts/builds/serviços temporários próprios; preservar app e desktop ligados para o teste, dados/perfis/credenciais/recibos e recursos alheios, com medidas de espaço antes/depois.

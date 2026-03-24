# Rascunho de Metodos e Analise

Este arquivo sera o ponto de trabalho para definirmos as regras dos metodos, criterios de entrada, filtros, leitura dos jogadores e validacoes.

## Objetivo

- Centralizar as ideias dos metodos em um unico lugar.
- Transformar conversa em regra objetiva.
- Separar o que ja esta definido do que ainda esta em aberto.
- Facilitar futuras implementacoes no painel, backtest e alertas.

## Como Vamos Trabalhar

- Cada metodo deve ter nome claro e identificador unico.
- Cada regra precisa dizer quando entra, quando nao entra e como validar.
- Sempre que uma ideia surgir na conversa, este arquivo sera atualizado.
- Itens sem decisao fechada ficam marcados como pendentes.

## Estrutura Padrao de Cada Metodo

### 1. Nome do metodo

- Nome comercial:
- Nome interno:
- Liga alvo:
- Objetivo do metodo:

### 2. Contexto de uso

- Cenario ideal:
- Cenario que deve evitar:
- Tipo de campeonato:
- Quantidade minima de jogos necessaria:

### 3. Regra de entrada

- Condicao principal:
- Condicoes complementares:
- Ordem de checagem:
- O que invalida a entrada:

### 4. Leitura estatistica

- Janela de analise:
- Peso dos ultimos jogos:
- Importancia do confronto direto:
- Importancia do campeonato atual:
- Importancia do mando:
- Importancia do intervalo:

### 5. Saida esperada

- Tipo de sinal:
- Mercado alvo:
- Intensidade do sinal:
- Justificativa esperada:

### 6. Validacao

- Como saber se o metodo esta funcionando:
- Metricas principais:
- Metricas secundarias:
- Minimo de amostra aceitavel:

### 7. Riscos

- Principais falsos positivos:
- Cenarios perigosos:
- Quando pausar o metodo:

## Regras Gerais de Analise

### Jogador

- Ler sequencia recente de resultados.
- Separar desempenho geral de desempenho no campeonato atual.
- Observar volume real de jogos antes de confiar em taxa percentual.
- Considerar ritmo recente de vitorias, empates e derrotas.

### Head to Head

- Usar confronto direto como reforco, nao como unica regra.
- Priorizar confrontos recentes quando o historico for muito antigo.
- Separar H2H por campeonato quando isso alterar muito a leitura.

### Campeonato

- Verificar se a sequencia pertence ao mesmo campeonato.
- Medir repeticao de adversarios.
- Entender se o formato do campeonato altera a frequencia dos confrontos.

### Forma recente

- Registrar a sequencia em linha unica no formato W D L.
- Definir o tamanho da janela de leitura por metodo.
- Confirmar se a ordem visual sera da mais antiga para a mais recente ou o contrario.

## Campos que Podemos Usar na Analise

- Nome do jogador
- Liga
- Campeonato
- Data do jogo
- Resultado final
- Resultado do intervalo
- Placar final
- Placar do intervalo
- Sequencia recente
- Win rate
- Win streak
- Loss streak
- Head to head
- Resumo por liga
- Resumo por metodo

## Decisoes Pendentes

- Definir lista oficial de metodos ativos.
- Definir janela padrao de forma recente para cada tela.
- Definir quando H2H tem peso alto, medio ou baixo.
- Definir se metodo sera avaliado por campeonato, jogador, dupla de confronto ou todos.
- Definir como tratar empates dentro de cada metodo.
- Definir como mostrar confianca do sinal.

## Primeiro Metodo para Preencher

### Metodo

- Nome comercial: Metodo (2D) Confrontos
- Nome interno: confrontos-2d
- Liga alvo: GT League, 8min Battle, 6min Volta
- Objetivo do metodo: Detectar o jogo atual quando o jogador1 chega nele apos 2 jogos sem ganhar, com 1 derrota e 1 empate em qualquer ordem, contra o mesmo jogador2 dentro do historico do confronto no dia.

### Entrada

- Regra 1: O confronto deve ser lido na ordem jogador1 x jogador2.
- Regra 2: Os 2 jogos imediatamente anteriores no dia precisam formar a combinacao derrota + empate, aceitando L D ou D L na sequencia interna.
- Regra 3: O metodo so existe se houver jogo seguinte ao bloco de 2 jogos sem ganhar, ou seja, o jogo atual e a entrada.

### Filtros

- Filtro 1: Agrupar por confronto e por dia operacional.
- Filtro 2: Nao misturar a perspectiva de jogador1 com a de jogador2.
- Filtro 3: Se os 2 ultimos jogos do dia formarem a sequencia do metodo e nao existir jogo posterior, nao contar ocorrencia.

### Confirmacoes

- Confirmacao 1: O jogo seguinte ao bloco derrota + empate, em qualquer ordem, e a ocorrencia do metodo.
- Confirmacao 2: O resultado da ocorrencia pode ser W, D ou L; a contagem depende da existencia do jogo, nao do resultado final.
- Confirmacao 3: O historico do dia deve mostrar a sequencia completa do confronto em ordem cronologica.

### Observacao complementar

- O metodo (2D+) representa duas derrotas seguidas nos 2 jogos anteriores, no padrao L L, e a ocorrencia e o jogo seguinte.
- O metodo (3D) representa os 3 jogos anteriores sem vencer, com pelo menos 1 derrota na sequencia.
- O metodo (4D) representa os 4 jogos anteriores sem vencer, com pelo menos 1 derrota na sequencia.

### Bloqueios

- Bloqueio 1: Nao contar sequencias incompletas no fim do dia.
- Bloqueio 2: Nao consolidar confronto em ordem alfabetica se isso inverter o jogador observado.
- Bloqueio 3: Nao tratar empate como derrota no metodo (2D).

### Como analisar

- O que olhar primeiro:
- O que pesa mais:
- O que pesa menos:
- O que invalida:

### Como medir

- Meta de win rate:
- Meta de volume:
- Meta de estabilidade:
- Observacoes:

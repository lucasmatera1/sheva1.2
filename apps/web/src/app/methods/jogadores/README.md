# Metodos Jogador

Este documento define a primeira familia de metodos da area de jogadores.

O objetivo aqui e padronizar como uma sequencia do jogador dentro do dia vira um gatilho de metodo e como o jogo seguinte entra na estatistica.

## Escopo inicial

Os primeiros metodos a cadastrar sao:

1. 2 loses streak
2. 2 loses full streak
3. 3 loses streak
4. 3 loses full streak
5. 4 loses streak
6. 4 loses full streak
7. 5 loses streak
8. 5 loses full streak

## Conceitos base

### Unidade de leitura

- A leitura e sempre por jogador.
- A leitura e sempre dentro do dia.
- A sequencia nao deve atravessar para o dia seguinte.

### Resultado de cada jogo

Para cada jogo do jogador, considerar apenas tres saidas:

- W = vitoria
- D = empate
- L = derrota

## Diferenca entre loses streak e loses full streak

### loses streak

No metodo loses streak, qualquer resultado que nao seja vitoria conta como continuidade negativa.

Ou seja:

- D conta
- L conta
- W quebra a sequencia

Exemplos validos para 2 loses streak:

- D L
- L D
- D D
- L L

Exemplos validos para 3 loses streak:

- D D L
- D L D
- L D D
- L L D
- D D D
- L L L

Exemplos validos para 4 loses streak:

- D D D L
- D L D L
- L D D D
- L L D L
- D D D D
- L L L L

Exemplos validos para 5 loses streak:

- D D D D L
- D L D L D
- L D D D D
- L L D L L
- D D D D D
- L L L L L

Resumo:

- loses streak = sequencia de jogos sem vencer

### loses full streak

No metodo loses full streak, apenas derrota real conta como continuidade negativa.

Ou seja:

- L conta
- D nao conta
- W nao conta

Exemplos validos para 2 loses full streak:

- L L

Exemplos validos para 3 loses full streak:

- L L L

Exemplos validos para 4 loses full streak:

- L L L L

Exemplos validos para 5 loses full streak:

- L L L L L

Exemplos invalidos para loses full streak:

- D L
- L D
- D D
- D L L

Resumo:

- loses full streak = sequencia de derrotas puras

## Regra operacional do gatilho

Proposta inicial para implementacao:

1. Ordenar os jogos do jogador dentro do dia do mais antigo para o mais recente.
2. Antes de cada jogo, olhar para os jogos imediatamente anteriores no mesmo dia.
3. Se os ultimos N jogos atenderem a regra do metodo, o jogo atual vira a entrada do metodo.
4. O resultado do jogo atual e o que sera contabilizado como resposta do metodo.

Em outras palavras:

- a sequencia e o gatilho
- o proximo jogo apos a sequencia e o jogo analisado

## Exemplo pratico: 2 loses streak

Sequencia do jogador no dia:

- J1 = W
- J2 = D
- J3 = L
- J4 = W

Leitura:

- Antes do J4, os dois jogos anteriores sao D L
- Como D e L contam como nao-vitoria, o J4 entra no metodo 2 loses streak
- O resultado a ser contabilizado para o metodo e o resultado do J4

Outro exemplo:

- J1 = L
- J2 = D
- J3 = D

Leitura:

- Antes do J3, os dois jogos anteriores sao L D
- O J3 entra no metodo 2 loses streak
- O resultado do J3 e o retorno do metodo

## Exemplo pratico: 2 loses full streak

Sequencia do jogador no dia:

- J1 = L
- J2 = L
- J3 = W

Leitura:

- Antes do J3, os dois jogos anteriores sao L L
- O J3 entra no metodo 2 loses full streak
- O resultado do J3 e o retorno do metodo

Se a sequencia fosse:

- J1 = D
- J2 = L
- J3 = W

Entao:

- isso entra em 2 loses streak
- isso nao entra em 2 loses full streak

## Regras dos primeiros oito metodos

As mesmas regras se estendem para 4 e 5 jogos anteriores.

### Metodo 1: 2 loses streak

Gatilho:

- os 2 jogos anteriores no mesmo dia precisam ser formados apenas por D ou L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 2: 2 loses full streak

Gatilho:

- os 2 jogos anteriores no mesmo dia precisam ser exatamente L L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 3: 3 loses streak

Gatilho:

- os 3 jogos anteriores no mesmo dia precisam ser formados apenas por D ou L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 4: 3 loses full streak

Gatilho:

- os 3 jogos anteriores no mesmo dia precisam ser exatamente L L L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 5: 4 loses streak

Gatilho:

- os 4 jogos anteriores no mesmo dia precisam ser formados apenas por D ou L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 6: 4 loses full streak

Gatilho:

- os 4 jogos anteriores no mesmo dia precisam ser exatamente L L L L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 7: 5 loses streak

Gatilho:

- os 5 jogos anteriores no mesmo dia precisam ser formados apenas por D ou L

Resposta analisada:

- resultado do jogo seguinte

### Metodo 8: 5 loses full streak

Gatilho:

- os 5 jogos anteriores no mesmo dia precisam ser exatamente L L L L L

Resposta analisada:

- resultado do jogo seguinte

## Como contabilizar

Para cada metodo, a tabela final deve guardar pelo menos:

- entradas
- wins apos o gatilho
- draws apos o gatilho
- losses apos o gatilho
- win rate apos o gatilho
- draw rate apos o gatilho
- loss rate apos o gatilho

Modelo mental:

- quantas vezes o jogador entrou no metodo
- o que aconteceu no jogo imediatamente seguinte

## Exemplo de tabela esperada

### 2 loses streak

- entradas: 120
- W apos gatilho: 54
- D apos gatilho: 28
- L apos gatilho: 38

### 2 loses full streak

- entradas: 44
- W apos gatilho: 21
- D apos gatilho: 7
- L apos gatilho: 16

## Ponto importante sobre sobreposicao

Ainda existe uma decisao de regra que precisa ser mantida explicita no codigo.

### Opcao A: permitir sobreposicao

Exemplo:

- J1 = D
- J2 = L
- J3 = D
- J4 = W

Nesse caso:

- J3 pode ser resposta do gatilho D L
- J4 pode ser resposta do gatilho L D

Ou seja, janelas deslizantes sao permitidas.

### Opcao B: bloquear sobreposicao

Depois que um gatilho dispara, o metodo espera o jogo resposta e so depois volta a procurar uma nova entrada.

## Recomendacao inicial

Para a versao 1, a recomendacao e:

- usar janelas deslizantes
- permitir sobreposicao
- sempre respeitar o limite do dia

Isso simplifica a implementacao e deixa o comportamento estatistico mais previsivel.

Se depois quisermos, podemos criar versoes separadas:

- 2 loses streak sliding
- 2 loses streak non-overlap

## Resumo final

- loses streak = qualquer sequencia sem vitoria, usando D e L
- loses full streak = somente derrotas puras, usando apenas L
- o metodo entra quando a sequencia anterior bate a regra
- o jogo contabilizado e o proximo jogo do jogador no mesmo dia
- a leitura nao deve misturar dias diferentes

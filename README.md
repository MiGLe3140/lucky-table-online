# Lucky Table Online V2 — Texas Hold'em

Protótipo web para telemóvel com fichas virtuais. Inclui salas públicas/privadas, perfis locais com fotografia, chat, Blackjack e roleta simplificados, slots/dados a solo e uma mesa de Texas Hold'em com cartas privadas, cartas comunitárias, blinds, rondas de apostas e showdown.

## Requisitos
- Node.js 18 ou superior
- Ligação à Internet para instalar as dependências

## Executar no computador
1. Extrai o ZIP.
2. Abre um terminal dentro da pasta `lucky_table_online_v2`.
3. Executa `npm install`.
4. Executa `npm start`.
5. Abre `http://localhost:3000`.

Para testar com amigos na mesma rede, o servidor tem de estar acessível na rede local. Para amigos fora da tua rede, publica a pasta num serviço de alojamento que suporte Node.js e WebSockets/Socket.IO; depois partilha o URL público.

## Poker Texas Hold'em
- 2 cartas privadas por jogador e até 5 cartas comunitárias.
- Blinds de 5/10 fichas virtuais.
- Ações: fold, check, call e raise.
- Avaliação de mãos até 7 cartas e showdown no river.
- O baralho e as decisões de resultado são processados no servidor; cada jogador só recebe as próprias cartas privadas.

## Limitações do protótipo
- Não tem contas registadas nem base de dados; perfis ficam no navegador e salas/saldos desaparecem quando o servidor reinicia.
- O poker usa regras de apostas simplificadas: ainda não tem side pots completos para cenários de all-in nem todos os pormenores de uma sala comercial.
- Blackjack e roleta são versões simplificadas.
- Não usa dinheiro real nem oferece prémios convertíveis em dinheiro.

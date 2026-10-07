# DApp NFT Farm

Plataforma de farm na Polygon: compre **ovos misteriosos**, choque **Speed NFTs** com velocidade aleatória (10–100), faça **stake dos NFTs** para farmar o token **DAPPF** e **bloqueie DAPPF** por 3, 6 ou 12 meses com rendimento fixo.

```
Ovo (POL) ──choca──▶ Speed NFT ──stake──▶ NFTFarm ──emite──▶ DAPPF ──stake──▶ TokenStaking
```

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `contracts/` | `DAppToken` (ERC-20 + Permit), `SpeedNFT` (ERC-721, commit-reveal), `NFTFarm`, `TokenStaking` |
| `test/` | 46 testes Hardhat cobrindo os quatro contratos |
| `scripts/` | `deploy.cjs` (deploy + permissões + endereços) e `auto-withdraw.cjs` (bot de tesouraria) |
| `src/` | Frontend React 19 + Vite + Tailwind 4 + ethers v6 + Firebase |
| `firestore.rules` | Regras de segurança do Firestore (obrigatório publicar) |

## Rodando localmente

```bash
npm install
cp .env.example .env          # preencha PRIVATE_KEY só quando for fazer deploy em rede real

# Terminal 1: blockchain local
npm run node

# Terminal 2: deploy local (cunha 4 NFTs de teste para a primeira conta do Hardhat)
STAKING_REWARD_POOL=1000000 npm run deploy:local
# copie as linhas VITE_* impressas para .env.local

# Terminal 3: frontend
npm run dev
```

Na MetaMask, adicione a rede `http://127.0.0.1:8545` (chain id 31337) e importe a chave privada da conta #0 do Hardhat.

Outros comandos: `npm test` (contratos), `npm run compile`, `npm run typecheck`, `npm run build`.

## Deploy em testnet / mainnet

```bash
# Amoy (testnet) — faucet: https://faucet.polygon.technology
npm run deploy:amoy

# Polygon mainnet
OWNER_ADDRESS=0xSeuMultisig STAKING_REWARD_POOL=1000000 npm run deploy:polygon
```

O script:

1. faz o deploy dos quatro contratos;
2. concede `MINTER_ROLE` do token ao `NFTFarm` (só o farm cunha DAPPF);
3. opcionalmente cunha `STAKING_REWARD_POOL` DAPPF para o pool do staking;
4. se `OWNER_ADDRESS` for informado, propõe a transferência de propriedade (o novo dono precisa chamar `acceptOwnership()` em cada contrato — `Ownable2Step` evita perder os contratos para um endereço digitado errado);
5. grava `deployments/<rede>.json` e imprime as variáveis `VITE_*` e os comandos de `hardhat verify`.

Depois do deploy, preencha `.env.local` e publique o frontend (`npm run build` gera `dist/`).

### Bot de saque

`npm run withdraw-bot` verifica periodicamente o saldo de vendas do `SpeedNFT` e envia para `TREASURY_ADDRESS`. Use uma hot wallet dedicada como dona do contrato e um cold wallet/multisig como tesouraria.

## Firebase

O app usa Firebase Auth (usuário + senha) e Firestore para perfis, vínculo de carteira e histórico. **Publique `firestore.rules`** — sem elas o banco fica aberto para qualquer visitante:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project dapp-farm
```

Para liberar o painel admin para a sua conta, crie o documento `admins/<seu UID>` no console (o UID aparece no painel quando a permissão é negada). Os controles on-chain continuam exigindo que a carteira conectada seja dona do contrato.

## Contratos

### DAppToken (DAPPF)
- Supply máximo de 400 bilhões; só `MINTER_ROLE` cunha.
- `ERC20Permit`: aprovar e stakear em uma única transação.

### SpeedNFT
- **Commit-reveal**: `buyEggs(qtd)` paga e registra o bloco; `hatchEggs(ids)` roda em um bloco posterior e sorteia a velocidade a partir do `blockhash` do bloco da compra. Como esse hash não existia no momento do pagamento, ninguém consegue simular e reverter até sair um lendário (a `publicMint` antiga permitia isso).
- Até 10 ovos por transação; qualquer um pode chocar qualquer ovo (o NFT sempre vai para o dono do ovo). Ovo não chocado em 256 blocos (~8,5 min) nasce com velocidade mínima — expirar nunca é vantagem.
- Metadata e SVG 100% on-chain, com raridade: Comum (10–39), Raro (40–69), Épico (70–89), Lendário (90–100).
- `adminMint` limitado ao intervalo 10–100; `pause()` pausa só as vendas; `withdraw(to)` com destino explícito.

### NFTFarm
- Recompensa = `velocidade × rewardRate` por segundo, com acumulador global (`accRewardPerSpeed`): mudar a taxa só afeta o futuro e as operações são O(1) por usuário.
- `stake`, `withdraw`, `emergencyWithdraw` e `claimAll` em lote (até 50 NFTs por transação).
- Saques funcionam mesmo pausado; `emergencyWithdraw` não toca no token, então um `MINTER_ROLE` revogado ou o supply máximo atingido nunca prendem NFTs. Ao atingir o `MAX_SUPPLY`, o farm paga o que ainda pode e mantém o restante como devido.
- `rewardRate` limitado a `MAX_REWARD_RATE`; `recoverERC721` devolve NFTs enviados por engano sem poder tocar nos que estão em stake.

### TokenStaking
- Planos configuráveis (`setPlan(meses, aprBps)`), padrão 22% APR proporcional: 5,5% / 11% / 22% para 3 / 6 / 12 meses.
- **Solvência garantida**: cada stake reserva sua recompensa do pool ao abrir; stake sem cobertura é recusado. O dono só retira o pool **não reservado** — o `emergencyWithdraw` antigo podia drenar principal e recompensas de todos.
- `stakeWithPermit`, `unstakeMany`, `fundRewards` aberto a qualquer um, `pause()` só para novas entradas.

## Segurança — leia antes de usar o repositório original

O arquivo `.zip` que estava neste repositório continha um `.env` com uma **chave privada real** e endereços de contratos já publicados na Polygon. Considere essa chave comprometida:

1. Transfira qualquer saldo dessa carteira para uma nova.
2. Se ela for dona dos contratos antigos, transfira a propriedade ou abandone-os.
3. Nunca mais use essa chave. O `.gitignore` agora bloqueia `.env*` e `*.zip`.

Os contratos antigos (`0xb582…`, `0x4B4f…`, `0xA68C…`, `0x3AD9…`) **não são compatíveis** com este frontend e têm as falhas descritas acima; faça um novo deploy.

Antes de mainnet com valor relevante, recomenda-se uma auditoria externa e, para o sorteio dos ovos, considerar Chainlink VRF caso o volume justifique (o commit-reveal atual protege contra usuários, mas um validador poderia, em teoria, descartar um bloco desfavorável).

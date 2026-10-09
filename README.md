# DApp NFT Farm

Plataforma de farm na Polygon: compre **ovos misteriosos**, choque **Speed NFTs** com velocidade aleatória (10–100), faça **stake dos NFTs** para farmar o token **DAPPF** e **bloqueie DAPPF** por 3, 6 ou 12 meses com rendimento fixo.

```
Ovo (POL) ──choca──▶ Speed NFT ──stake──▶ NFTFarm ──emite──▶ DAPPF ──stake──▶ TokenStaking
```

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `contracts/` | `DAppToken` (ERC-20 + Permit), `SpeedNFT` (ERC-721, commit-reveal), `NFTFarm`, `TokenStaking` |
| `test/` | 55 testes Hardhat cobrindo os quatro contratos |
| `scripts/` | `deploy.cjs` (deploy + permissões + endereços), `auto-withdraw.cjs` (varre vendas para a tesouraria) e `hatch-keeper.cjs` (choca ovos esquecidos) |
| `src/` | Frontend React 19 + Vite + Tailwind 4 + ethers v6 + Firebase |
| `firestore.rules` | Regras de segurança do Firestore (obrigatório publicar — `npm run rules:deploy`) |
| `android/`, `capacitor.config.ts` | App Android (Capacitor); APK gerado pelo workflow `.github/workflows/android.yml` |

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
OWNER_ADDRESS=0xSeuMultisig TREASURY_ADDRESS=0xSuaCarteiraFria STAKING_REWARD_POOL=1000000 npm run deploy:polygon
```

O script:

1. faz o deploy dos quatro contratos;
2. concede `MINTER_ROLE` do token ao `NFTFarm` (só o farm cunha DAPPF) e define a tesouraria do `SpeedNFT` (`TREASURY_ADDRESS`; sem ela, o deployer — nunca o `OWNER_ADDRESS` ainda não aceito, porque a varredura é pública e um endereço errado seria um ralo irreversível);
3. opcionalmente cunha `STAKING_REWARD_POOL` DAPPF para o pool do staking;
4. se `OWNER_ADDRESS` for informado, **propõe** a transferência de todos os contratos — nada muda até o novo dono chamar `acceptOwnership()` em `SpeedNFT`, `NFTFarm` e `TokenStaking` e `acceptDefaultAdminTransfer()` em `DAppToken`. Um endereço digitado errado simplesmente nunca aceita e o deployer continua no controle;
5. grava `deployments/<rede>.json` e imprime as variáveis `VITE_*` e os comandos de `hardhat verify`.

Depois do deploy, preencha `.env.local` e publique o frontend (`npm run build` gera `dist/`).

### Bots (sem chave privilegiada)

Os dois bots usam `PRIVATE_KEY` só para pagar gás. Use uma carteira separada com pouco saldo — ela **não** precisa ser dona de nada:

- `npm run withdraw-bot` chama `withdrawToTreasury()`, que qualquer um pode executar e que sempre paga a tesouraria fixada on-chain pelo dono (`setTreasury`). Um bot comprometido só consegue antecipar o saque, nunca desviá-lo.
- `npm run keeper` choca os ovos que os compradores não chocaram (fecharam a aba, caiu a conexão) antes que o prazo de 256 blocos expire. `hatchEggs` é pública e sempre cunha para o dono do ovo.

## App Android (APK)

O app Android é o mesmo frontend empacotado com [Capacitor](https://capacitorjs.com) (pasta `android/`). Dentro dele não existe extensão de carteira, então a conexão usa a **MetaMask Connect**: ao tocar em "Conectar com MetaMask", o app da MetaMask abre para você aprovar (ou a Play Store, se ela não estiver instalada) e depois é só voltar para o app. Não precisa de chave de API. A mesma integração passa a valer no navegador do celular e no computador sem a extensão (lá ela mostra um QR code).

**Gerar o APK pelo GitHub (recomendado):** cada push nesta branch ou na `main` roda o workflow `.github/workflows/android.yml`, que compila, assina e publica o arquivo em **Releases → `android-latest`** (pré-release). No celular, baixe o `.apk`, permita "instalar apps desconhecidos" para o navegador e abra o arquivo. Também dá para rodar manualmente em *Actions → Android APK → Run workflow*.

A configuração do app vem das **variáveis do repositório** (*Settings → Secrets and variables → Actions → Variables*), as mesmas do `.env.local`: `VITE_CHAIN_ID`, `VITE_TOKEN_ADDRESS`, `VITE_NFT_ADDRESS`, `VITE_FARM_ADDRESS`, `VITE_STAKING_ADDRESS` e, opcionalmente, `VITE_RPC_URL`, `VITE_EXPLORER_URL`, `VITE_APP_URL` e as `VITE_FIREBASE_*` (sem elas o app usa o projeto Firebase padrão). Depois de mudar, rode o workflow de novo para gerar um APK atualizado.

**Assinatura:** sem configuração, cada build é assinada com uma chave temporária — o APK instala normalmente, mas para instalar uma build nova é preciso desinstalar a anterior. Para atualizações por cima, crie uma chave uma única vez e cadastre-a como *secrets* do repositório:

```bash
# fora da pasta do projeto, para a chave nunca ir parar num commit
keytool -genkeypair -keystore ~/dappnftfarm-release.jks -storetype PKCS12 -alias dappnftfarm \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=DApp NFT Farm"
base64 -w0 ~/dappnftfarm-release.jks   # valor de ANDROID_KEYSTORE_BASE64
```

Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`dappnftfarm`) e `ANDROID_KEY_PASSWORD` (a mesma senha, em PKCS12). Guarde o arquivo `.jks` fora do repositório e faça backup dele: quem tiver essa chave pode publicar atualizações do app, e sem ela não dá para atualizar por cima. O `.gitignore` já recusa `*.jks`, `*.keystore` e `*.p12`.

**Gerar localmente** (precisa do Android Studio / Android SDK e JDK 21): `npm run android:apk` gera `android/app/build/outputs/apk/release/`; `npm run android:open` abre o projeto no Android Studio. Sem chave o APK sai sem assinatura; para assiná-lo, exporte antes `ANDROID_KEYSTORE_FILE` (caminho do `.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Ícone e splash vêm de `assets/` e são regenerados com `npx @capacitor/assets generate --android`.

## Firebase

O app usa Firebase Auth (usuário + senha) e Firestore para perfis, vínculo de carteira e histórico. **Publique `firestore.rules`** — sem elas o banco fica aberto para qualquer visitante:

```bash
npm i -g firebase-tools
firebase login
npm run rules:deploy        # usa firebase.json / .firebaserc (projeto dapp-farm)
```

As regras garantem, no servidor: um nome de usuário por conta e uma carteira por conta (ambos amarrados ao próprio perfil, sem squatting de nomes ou de endereços alheios), troca de carteira no máximo a cada 7 dias, flags de banimento alteráveis só por admins (inclusive contra `deleteField()`), índices sem listagem pública, e logs de atividade apenas do próprio usuário.

Para liberar o painel admin para a sua conta, crie o documento `admins/<seu UID>` no console (o UID aparece no painel quando a permissão é negada). Os controles on-chain continuam exigindo que a carteira conectada seja dona do contrato.

## Contratos

### DAppToken (DAPPF)
- Supply máximo de 400 bilhões; só `MINTER_ROLE` cunha.
- `ERC20Permit`: aprovar e stakear em uma única transação.
- Admin único com `AccessControlDefaultAdminRules`: a troca de admin é em duas etapas (`beginDefaultAdminTransfer` → `acceptDefaultAdminTransfer`).

### SpeedNFT
- **Commit-reveal**: `buyEggs(qtd)` paga e registra o bloco; `hatchEggs(ids)` roda em um bloco posterior e sorteia a velocidade a partir do `blockhash` do bloco da compra. Como esse hash não existia no momento do pagamento, ninguém consegue simular e reverter até sair um lendário (a `publicMint` antiga permitia isso).
- Até 10 ovos por transação; qualquer um pode chocar qualquer ovo (o NFT sempre vai para o dono do ovo). Ovo não chocado em 256 blocos (~8,5 min) nasce com velocidade mínima — expirar nunca é vantagem.
- Metadata e SVG 100% on-chain, com raridade: Comum (10–39), Raro (40–69), Épico (70–89), Lendário (90–100).
- `adminMint` limitado ao intervalo 10–100; `pause()` pausa só as vendas; `withdraw(to)` (dono) e `withdrawToTreasury()` (qualquer um, destino fixado pelo dono via `setTreasury`).
- `renounceOwnership` desabilitado nos três contratos `Ownable2Step`: um contrato sem dono nunca mais poderia ser despausado.

### NFTFarm
- Recompensa = `velocidade × rewardRate` por segundo, com acumulador global (`accRewardPerSpeed`): mudar a taxa só afeta o futuro e as operações são O(1) por usuário.
- `stake`, `withdraw`, `emergencyWithdraw` e `claimAll` em lote (até 50 NFTs por transação).
- `withdraw` **nunca** reverte por causa do token: farm pausado, supply máximo atingido ou `MINTER_ROLE` revogado devolvem os NFTs, mantêm a recompensa registrada e emitem `RewardDeferred(user, amount, reason)`. `claimAll` diferencia `SupplyExhausted` de `RewardMintFailed`. Quando o supply se esgota, a acumulação congela para todos (nada do que viesse depois poderia ser pago) e `getUserInfo` zera `rewardPerSecond`. `emergencyWithdraw` não toca no token.
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

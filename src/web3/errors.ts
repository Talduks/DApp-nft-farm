import { CHAIN, TOKEN_SYMBOL } from '../config';
import { INTERFACES } from './contracts';

const MESSAGES: Record<string, string> = {
  // SpeedNFT
  InvalidQuantity: 'Quantidade inválida: compre de 1 a 10 ovos por vez.',
  InsufficientPayment: 'O valor enviado é menor que o preço dos ovos.',
  UnknownEgg: 'Ovo não encontrado.',
  EggNotReady: 'O ovo ainda está incubando. Aguarde alguns segundos e tente de novo.',
  InvalidSpeed: 'Velocidade fora do intervalo permitido (10 a 100).',
  InvalidPrice: 'Preço inválido.',
  NothingToWithdraw: 'Não há saldo para sacar.',
  // NFTFarm
  EmptyBatch: 'Selecione pelo menos um NFT.',
  BatchTooLarge: 'Muitos NFTs de uma vez. Selecione até 50.',
  NotStaker: 'Este NFT não está em stake na sua carteira.',
  ZeroSpeed: 'Este NFT não tem velocidade de farm.',
  RateTooHigh: 'Taxa de recompensa acima do máximo permitido.',
  NothingToClaim: 'Não há recompensas para resgatar ainda.',
  SupplyExhausted: `O supply máximo de ${TOKEN_SYMBOL} foi atingido: não há mais recompensas a emitir.`,
  RewardMintFailed: `O farm não conseguiu emitir ${TOKEN_SYMBOL} agora (permissão do token). Suas recompensas continuam registradas; tente mais tarde.`,
  TreasuryNotSet: 'A tesouraria ainda não foi definida pelo dono do contrato.',
  RenounceDisabled: 'Este contrato não permite abrir mão da propriedade; transfira-a em vez disso.',
  AccessControlEnforcedDefaultAdminRules: 'O admin do token só muda pela transferência em duas etapas (beginDefaultAdminTransfer).',
  AccessControlInvalidDefaultAdmin: 'Apenas o admin pendente pode aceitar a transferência.',
  // TokenStaking
  ZeroAmount: 'Informe um valor maior que zero.',
  InvalidPlan: 'Este plano de staking não está disponível.',
  InvalidLockPeriod: 'Período de bloqueio inválido.',
  AprTooHigh: 'APR acima do máximo permitido (100%).',
  StakeNotFound: 'Stake não encontrado.',
  AlreadyWithdrawn: 'Este stake já foi resgatado.',
  StillLocked: 'O período de bloqueio ainda não terminou.',
  InsufficientRewardPool: 'O pool de recompensas não cobre esse stake. Tente um valor menor ou aguarde novos aportes.',
  // Token / OpenZeppelin
  MaxSupplyExceeded: `O supply máximo de ${TOKEN_SYMBOL} foi atingido.`,
  ERC20InsufficientBalance: `Saldo de ${TOKEN_SYMBOL} insuficiente.`,
  ERC20InsufficientAllowance: `Autorização de ${TOKEN_SYMBOL} insuficiente.`,
  ERC721IncorrectOwner: 'Você não é o dono deste NFT.',
  ERC721InsufficientApproval: 'O farm não tem autorização para mover este NFT.',
  ERC721NonexistentToken: 'Este NFT não existe.',
  EnforcedPause: 'Esta função está pausada pelo administrador no momento.',
  OwnableUnauthorizedAccount: 'Apenas o dono do contrato pode fazer isso.',
  AccessControlUnauthorizedAccount: 'Sua carteira não tem permissão para esta ação.',
  ZeroAddress: 'Endereço inválido.',
};

function decodeRevertData(data: unknown): string | undefined {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return undefined;
  for (const iface of Object.values(INTERFACES)) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      // try the next interface
    }
  }
  return undefined;
}

export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: unknown; info?: { error?: { code?: unknown } } };
  return e?.code === 'ACTION_REJECTED' || e?.code === 4001 || e?.info?.error?.code === 4001;
}

/** Name of the custom error a contract reverted with, when ethers or the RPC exposed its data. */
export function revertName(error: unknown): string | undefined {
  const e = error as any;
  return (
    e?.revert?.name ?? decodeRevertData(e?.data) ?? decodeRevertData(e?.info?.error?.data?.data) ?? decodeRevertData(e?.info?.error?.data)
  );
}

/** Turns wallet, RPC and contract errors into a short message in Portuguese. */
export function parseError(error: unknown): string {
  const e = error as any;
  if (isUserRejection(e)) return 'Ação cancelada na carteira.';
  if (e?.code === 'INSUFFICIENT_FUNDS') return `Saldo de ${CHAIN.currency} insuficiente para o valor e o gás da transação.`;

  const name = revertName(e);
  if (name && MESSAGES[name]) return MESSAGES[name];

  if (e?.code === 'CALL_EXCEPTION') return 'A transação foi recusada pelo contrato.';
  const inner = `${e?.message ?? ''} ${e?.error?.message ?? ''} ${e?.info?.error?.message ?? ''}`;
  if (/timed out|timeout/i.test(inner)) return 'A MetaMask não respondeu a tempo. Abra o app da MetaMask e tente de novo.';
  if (e?.code === 'NETWORK_ERROR' || e?.code === 'TIMEOUT') return 'Erro de rede. Verifique sua conexão e tente novamente.';
  if (e?.code === -32002) return 'Já existe uma solicitação pendente na sua carteira. Abra a extensão para continuar.';
  return e?.shortMessage || e?.reason || e?.message || 'Erro desconhecido.';
}

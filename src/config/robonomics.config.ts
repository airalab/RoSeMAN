import { registerAs } from '@nestjs/config';

export default registerAs('robonomics', () => ({
  wsEndpoint:
    process.env.ROBONOMICS_WS || 'wss://polkadot.rpc.robonomics.network',
  startBlock: parseInt(process.env.ROBONOMICS_START_BLOCK || '0', 10),
  stateKey: process.env.ROBONOMICS_STATE_KEY || 'polkadot_robonomics',
  accounts: process.env.ROBONOMICS_ACCOUNTS
    ? process.env.ROBONOMICS_ACCOUNTS.split(',').map((a) => a.trim())
    : [],
}));

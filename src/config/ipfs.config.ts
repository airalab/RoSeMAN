import { registerAs } from '@nestjs/config';

export default registerAs('ipfs', () => ({
  gateways: process.env.IPFS_GATEWAYS
    ? process.env.IPFS_GATEWAYS.split(',').map((g) => g.trim())
    : [
        'https://ipfs.io/ipfs/',
        'https://gateway.pinata.cloud/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/',
      ],
  fetchTimeout: parseInt(process.env.IPFS_FETCH_TIMEOUT || '30000', 10),
  pollInterval: parseInt(process.env.IPFS_POLL_INTERVAL || '10000', 10),
  dirSender: process.env.IPFS_DIR_SENDER || '',
}));

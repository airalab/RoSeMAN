import axios from "axios";

export async function cat(hash) {
  const res = await axios.get(`https://gateway.pinata.cloud/ipfs/${hash}`);
  return JSON.stringify(res.data);
}

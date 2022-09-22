import { expect } from 'chai'
import { ethers } from 'hardhat'
import * as hubbleBls from '@thehubbleproject/bls'
import { arrayify, keccak256 } from 'ethers/lib/utils'

import { BLSOpen__factory, ProxyAdmin__factory, VerificationGateway__factory } from '../typechain'
import { BLSWallet__factory } from '../typechain/factories/contracts/samples/BLSWallet'

const blsDomain = arrayify(keccak256('0xfeedbee5'))

describe('BLSWallet (web3well)', () => {
  it('deploys contracts', async () => {
    const signer = ethers.provider.getSigner()

    const [blsOpen, blsWalletImpl, proxyAdmin] = await Promise.all([
      (async () => await (await new BLSOpen__factory(signer).deploy()).deployed())(),
      (async () => await (await new BLSWallet__factory(signer).deploy()).deployed())(),
      (async () => await (await new ProxyAdmin__factory(signer).deploy()).deployed())()
    ])

    const vg = await (await new VerificationGateway__factory(signer).deploy(
      blsOpen.address,
      blsWalletImpl.address,
      proxyAdmin.address
    )).deployed()

    const signerFactory = await hubbleBls.signer.BlsSignerFactory.new()

    const privateKey = '0x0001020304050607080910111213141516171819202122232425262728293031'
    const walletSigner = signerFactory.getSigner(blsDomain, privateKey)

    const wallet = BLSWallet__factory.connect(
      await vg.callStatic.getOrCreateWallet(walletSigner.pubkey),
      signer
    )

    expect(await ethers.provider.getCode(wallet.address)).to.eq('0x')
    await (await vg.getOrCreateWallet(walletSigner.pubkey)).wait()
    expect(await ethers.provider.getCode(wallet.address)).not.to.eq('0x')
  })
})

export {}

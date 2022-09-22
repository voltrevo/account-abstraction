import { expect } from 'chai'
import { ethers } from 'hardhat'
import * as hubbleBls from '@thehubbleproject/bls'
import { arrayify, hexConcat, keccak256 } from 'ethers/lib/utils'

import { BLSOpen__factory, EntryPoint__factory, IEntryPoint, MockERC20__factory, ProxyAdmin__factory, VerificationGateway__factory } from '../typechain'
import { BLSWallet__factory } from '../typechain/factories/contracts/samples/BLSWallet'
import { UserOperation } from './UserOperation'
import { BLSWallet } from '../typechain/contracts/samples/BLSWallet'
import { BlsSignerFactory } from '@thehubbleproject/bls/dist/signer'

const blsDomain = arrayify(keccak256('0xfeedbee5'))

describe('BLSWallet (web3well)', () => {
  it('Can mint a token via 4337 EntryPoint', async () => {
    const {
      signer,
      entryPoint4337,
      mockToken,
      verificationGateway,
      TestWallet
    } = await Fixture(1)

    const wallet = await TestWallet(0)

    const callData = wallet.interface.encodeFunctionData(
      'performOperation',
      [
        {
          nonce: 0,
          actions: [
            {
              ethValue: 0,
              contractAddress: mockToken.address,
              encodedFunction: mockToken.interface.encodeFunctionData(
                'mint',
                [wallet.address, 1]
              )
            }
          ]
        }
      ]
    )

    const userOp: UserOperation = {
      sender: wallet.address,
      nonce: 0,
      initCode: '0x',
      callData,
      callGasLimit: 1_000_000_000,
      verificationGasLimit: 1_000_000_000,
      preVerificationGas: 1_000_000_000,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      paymasterAndData: '0x',
      signature: '0x'
    }

    const userOpAggregations: IEntryPoint.UserOpsPerAggregatorStruct = {
      userOps: [userOp],
      aggregator: verificationGateway.address,
      signature: hexConcat(wallet.blsSigner.sign(await verificationGateway.getRequestId(userOp)))
    }

    await (await entryPoint4337.handleAggregatedOps([userOpAggregations], await signer.getAddress())).wait()

    expect((await mockToken.balanceOf(wallet.address)).toNumber()).to.eq(1)
  })
})

type BlsSigner = ReturnType<BlsSignerFactory['getSigner']>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function Fixture (walletCount: number) {
  const signer = ethers.provider.getSigner()

  const [entryPoint4337, blsOpen, blsWalletImpl, proxyAdmin, mockToken] = await Promise.all([
    (async () => await (await new EntryPoint__factory(signer).deploy(
      ethers.utils.parseEther('1'),
      100
    )).deployed())(),
    (async () => await (await new BLSOpen__factory(signer).deploy()).deployed())(),
    (async () => await (await new BLSWallet__factory(signer).deploy()).deployed())(),
    (async () => await (await new ProxyAdmin__factory(signer).deploy()).deployed())(),
    (async () => await (await new MockERC20__factory(signer).deploy('Mock Token', 'MOK', 0)).deployed())()
  ])

  const verificationGateway = await (await new VerificationGateway__factory(signer).deploy(
    blsOpen.address,
    blsWalletImpl.address,
    proxyAdmin.address,
    entryPoint4337.address
  )).deployed()

  const signerFactory = await hubbleBls.signer.BlsSignerFactory.new()

  return {
    signer,
    entryPoint4337,
    blsOpen,
    blsWalletImpl,
    proxyAdmin,
    mockToken,
    verificationGateway,
    TestWallet: async (index: number): Promise<BLSWallet & { blsSigner: BlsSigner }> => {
      const privateKey = keccak256(new TextEncoder().encode(`test-wallet-${index}`))

      const walletSigner = signerFactory.getSigner(blsDomain, privateKey)

      const wallet = BLSWallet__factory.connect(
        await verificationGateway.callStatic.getOrCreateWallet(walletSigner.pubkey),
        signer
      )

      expect(await ethers.provider.getCode(wallet.address)).to.eq('0x')
      await (await verificationGateway.getOrCreateWallet(walletSigner.pubkey)).wait()
      expect(await ethers.provider.getCode(wallet.address)).not.to.eq('0x')

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        ...wallet,
        blsSigner: walletSigner
      } as BLSWallet & { blsSigner: BlsSigner }
    }
  }
}

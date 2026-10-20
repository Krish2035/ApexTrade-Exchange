import { walletLedgerService } from '../services/walletLedgerService.js';

export class WalletController {
  static getWallets(req, res, next) {
    try {
      const { userId } = req.params;
      const wallets = walletLedgerService.getUserWallets(userId);
      return res.json({
        userId,
        wallets
      });
    } catch (err) {
      next(err);
    }
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./HederaResponseCodes.sol";
import "./ILPModule.sol";

// HTS for associate, approve, approveNFT
interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
    function transferToken(address token, address from, address to, int64 amount) external returns (int64 responseCode);
    function approveNFT(address token, address approved, int64 serialNumber) external returns (int64 responseCode);
    function approve(address token, address spender, uint256 amount) external returns (int64 responseCode);
}

interface ISaucerSwapV2NonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    struct DecreaseLiquidityParams {
        uint256 tokenSN;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    struct CollectParams {
        uint256 tokenSN;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function mint(MintParams calldata params) external payable returns (uint256 tokenSN, uint128 liquidity, uint256 amount0, uint256 amount1);
    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function burn(uint256 tokenSN) external payable;
    function positions(uint256 tokenSN) external view returns (
        uint96 nonce,
        address operator,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    );
}

interface IWHBAR {
    function balanceOf(address account) external view returns (uint256);
    /// @dev SaucerSwap WHBAR: withdraw(src, dst, wad) - burns WHBAR from src, sends HBAR to dst
    function withdraw(address src, address dst, uint256 wad) external;
}

interface IWhbarHelper {
    function deposit() external payable;
}

interface ISaucerSwapV1Router {
    function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
    function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external returns (uint256 amountToken, uint256 amountETH);
    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB);
}

/**
 * @title VaultLPManager
 * @dev LP contract for SaucerSwap V1/V2. Only the vault (proxy) may call LP actions.
 * Vault transfers tokens/HBAR here, then calls createLPPosition etc.; this contract owns LP NFTs.
 * Vault pulls assets back via withdrawToVault / withdrawHbarToVault.
 */
contract VaultLPManager is ILPModule {
    address constant HTS_PRECOMPILE = 0x0000000000000000000000000000000000000167;

    IHederaTokenService private hts;

    address public vault;   // only this address can call LP actions and withdrawToVault
    address public admin;           // can setVault, configure, associate, approve

    address public SAUCERSWAP_NFT_MANAGER;
    address public SAUCERSWAP_LP_NFT;
    address public WHBAR_TOKEN;
    address public WHBAR_HELPER;
    address public SAUCERSWAP_V1_ROUTER;

    struct LPPosition {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool active;
    }
    mapping(uint256 => LPPosition) public lpPositions;
    uint256[] public lpPositionSerials;

    mapping(address => bool) public isCompositionToken;

    event LPPositionCreated(uint256 indexed tokenSN, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1);
    event LPPositionDecreased(uint256 indexed tokenSN, uint128 liquidityRemoved, uint256 amount0, uint256 amount1);
    event LPFeesCollected(uint256 indexed tokenSN, uint256 amount0, uint256 amount1);
    event LPPositionClosed(uint256 indexed tokenSN);
    event WithdrawnToVault(address token, uint256 amount);
    event WithdrawnHbarToVault(uint256 amount);
    event VaultSet(address indexed vault);
    event SaucerSwapConfigUpdated(address nftManager, address lpNft, address whbar);
    event SaucerSwapV1ConfigUpdated(address router);
    event CompositionTokenSet(address token, bool allowed);
    event AdminSet(address indexed oldAdmin, address indexed newAdmin);

    error OnlyVault();
    error OnlyAdmin();
    error SaucerSwapNotConfigured();
    error LPPositionNotFound(uint256 tokenSN);
    error InsufficientLiquidity(uint256 tokenSN, uint128 requested, uint128 available);
    error TokenNotInComposition(address token);
    error NftManagerNotSet();
    error LpNftNotSet();
    error WhbarNotSet();
    error WhbarHelperNotSet();
    error RouterNotSet();
    error InsufficientHbar();
    error InsufficientMintFee();
    error ApprovalFailed(address token);
    error InvalidAdmin();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(address _admin) {
        admin = _admin;
        hts = IHederaTokenService(HTS_PRECOMPILE);
    }

    receive() external payable {}

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidAdmin();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminSet(oldAdmin, newAdmin);
    }

    function setVault(address _vault) external override onlyAdmin {
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setCompositionToken(address token, bool allowed) external onlyAdmin {
        isCompositionToken[token] = allowed;
        emit CompositionTokenSet(token, allowed);
    }

    function configureSaucerSwap(address nftManager, address lpNft, address whbar, address whbarHelper) external override onlyAdmin {
        if (nftManager == address(0)) revert NftManagerNotSet();
        if (lpNft == address(0)) revert LpNftNotSet();
        if (whbar == address(0)) revert WhbarNotSet();
        if (whbarHelper == address(0)) revert WhbarHelperNotSet();
        SAUCERSWAP_NFT_MANAGER = nftManager;
        SAUCERSWAP_LP_NFT = lpNft;
        WHBAR_TOKEN = whbar;
        WHBAR_HELPER = whbarHelper;
        emit SaucerSwapConfigUpdated(nftManager, lpNft, whbar);
    }

    function configureSaucerSwapV1(address router) external override onlyAdmin {
        if (router == address(0)) revert RouterNotSet();
        SAUCERSWAP_V1_ROUTER = router;
        emit SaucerSwapV1ConfigUpdated(router);
    }

    function associateSaucerSwapTokens() external override {
        if (SAUCERSWAP_LP_NFT == address(0) || WHBAR_TOKEN == address(0)) revert SaucerSwapNotConfigured();
        int64 rc;
        rc = hts.associateToken(address(this), SAUCERSWAP_LP_NFT);
        if (rc != HederaResponseCodes.SUCCESS && rc != int64(HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) revert ApprovalFailed(SAUCERSWAP_LP_NFT);
        rc = hts.associateToken(address(this), WHBAR_TOKEN);
        if (rc != HederaResponseCodes.SUCCESS && rc != int64(HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) revert ApprovalFailed(WHBAR_TOKEN);
    }

    function associateTokenAdmin(address token) external override onlyAdmin {
        int64 rc = hts.associateToken(address(this), token);
        if (rc != HederaResponseCodes.SUCCESS && rc != int64(HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) revert ApprovalFailed(token);
    }

    function approveSaucerSwapSpending(address token, uint256 amount) external override onlyAdmin {
        if (SAUCERSWAP_NFT_MANAGER == address(0)) revert SaucerSwapNotConfigured();
        int64 rc = hts.approve(token, SAUCERSWAP_NFT_MANAGER, amount);
        if (rc != 22) revert ApprovalFailed(token);
    }

    function approveSaucerSwapV1Spending(address token, uint256 amount) external override onlyAdmin {
        if (SAUCERSWAP_V1_ROUTER == address(0)) revert SaucerSwapNotConfigured();
        int64 rc = hts.approve(token, SAUCERSWAP_V1_ROUTER, amount);
        if (rc != 22) revert ApprovalFailed(token);
    }

    function _getMintFeeInHbar() internal pure returns (uint256) {
        return 1e8; // 1 HBAR
    }

    function _isCompositionToken(address /* token */) internal pure returns (bool) {
        return true; // No token restriction – any SaucerSwap-eligible token allowed
    }

    function _wrapHbarIfNeeded(address token0, address token1, uint256 amount0Desired, uint256 amount1Desired) internal returns (uint256 hbarWrapped) {
        if (token0 == WHBAR_TOKEN) hbarWrapped = amount0Desired;
        else if (token1 == WHBAR_TOKEN) hbarWrapped = amount1Desired;
        if (hbarWrapped > 0) {
            uint256 mintFee = _getMintFeeInHbar();
            if (address(this).balance < hbarWrapped + mintFee) revert InsufficientHbar();
            if (WHBAR_HELPER == address(0)) revert WhbarHelperNotSet();
            IWhbarHelper(WHBAR_HELPER).deposit{value: hbarWrapped}();
        }
    }

    function _storeLPPosition(uint256 tokenSN, ILPModule.CreateLPParams calldata params, uint128 liquidity) internal {
        lpPositions[tokenSN] = LPPosition({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            active: true
        });
        lpPositionSerials.push(tokenSN);
    }

    /// @dev Pull tokens from vault (vault must approve this contract first). WHBAR comes via msg.value.
    function createLPPosition(ILPModule.CreateLPParams calldata params) external payable override onlyVault returns (
        uint256 tokenSN,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    ) {
        if (SAUCERSWAP_NFT_MANAGER == address(0)) revert SaucerSwapNotConfigured();
        if (!_isCompositionToken(params.token0)) revert TokenNotInComposition(params.token0);
        if (!_isCompositionToken(params.token1)) revert TokenNotInComposition(params.token1);
        if (vault == address(0)) revert SaucerSwapNotConfigured();

        if (params.token0 != WHBAR_TOKEN) {
            int64 r0 = hts.transferToken(params.token0, vault, address(this), int64(uint64(params.amount0Desired)));
            if (r0 != HederaResponseCodes.SUCCESS) revert ApprovalFailed(params.token0);
        }
        if (params.token1 != WHBAR_TOKEN) {
            int64 r1 = hts.transferToken(params.token1, vault, address(this), int64(uint64(params.amount1Desired)));
            if (r1 != HederaResponseCodes.SUCCESS) revert ApprovalFailed(params.token1);
        }

        uint256 mintFeeHbar = _getMintFeeInHbar();
        uint256 whbarNeeded = (params.token0 == WHBAR_TOKEN ? params.amount0Desired : params.amount1Desired);
        if (whbarNeeded > 0 && IWHBAR(WHBAR_TOKEN).balanceOf(address(this)) < whbarNeeded) {
            _wrapHbarIfNeeded(params.token0, params.token1, params.amount0Desired, params.amount1Desired);
        }
        if (address(this).balance < mintFeeHbar) revert InsufficientMintFee();

        ISaucerSwapV2NonfungiblePositionManager.MintParams memory mintParams = ISaucerSwapV2NonfungiblePositionManager.MintParams({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            amount0Desired: params.amount0Desired,
            amount1Desired: params.amount1Desired,
            amount0Min: params.amount0Min,
            amount1Min: params.amount1Min,
            recipient: address(this),
            deadline: params.deadline
        });

        (tokenSN, liquidity, amount0, amount1) = ISaucerSwapV2NonfungiblePositionManager(SAUCERSWAP_NFT_MANAGER).mint{value: mintFeeHbar}(mintParams);
        _storeLPPosition(tokenSN, params, liquidity);
        emit LPPositionCreated(tokenSN, params.token0, params.token1, params.fee, params.tickLower, params.tickUpper, liquidity, amount0, amount1);
    }

    function _decreaseLiquidityInternal(uint256 tokenSN, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) internal {
        ISaucerSwapV2NonfungiblePositionManager.DecreaseLiquidityParams memory params = ISaucerSwapV2NonfungiblePositionManager.DecreaseLiquidityParams({
            tokenSN: tokenSN,
            liquidity: liquidity,
            amount0Min: amount0Min,
            amount1Min: amount1Min,
            deadline: deadline
        });
        ISaucerSwapV2NonfungiblePositionManager(SAUCERSWAP_NFT_MANAGER).decreaseLiquidity(params);
    }

    function _collectTokensInternal(uint256 tokenSN) internal returns (uint256 amount0, uint256 amount1) {
        ISaucerSwapV2NonfungiblePositionManager.CollectParams memory params = ISaucerSwapV2NonfungiblePositionManager.CollectParams({
            tokenSN: tokenSN,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        });
        return ISaucerSwapV2NonfungiblePositionManager(SAUCERSWAP_NFT_MANAGER).collect(params);
    }

    function _withdrawToVault(address token0, address token1, uint256 amount0, uint256 amount1, bool withdrawHbar) internal {
        if (amount0 > 0) {
            if (token0 == WHBAR_TOKEN) {
                // Unwrap WHBAR -> HBAR, vault receives native HBAR
                IWHBAR(WHBAR_TOKEN).withdraw(address(this), vault, amount0);
            } else {
                int64 r = hts.transferToken(token0, address(this), vault, int64(uint64(amount0)));
                if (r != HederaResponseCodes.SUCCESS) revert ApprovalFailed(token0);
            }
        }
        if (amount1 > 0) {
            if (token1 == WHBAR_TOKEN) {
                IWHBAR(WHBAR_TOKEN).withdraw(address(this), vault, amount1);
            } else {
                int64 r = hts.transferToken(token1, address(this), vault, int64(uint64(amount1)));
                if (r != HederaResponseCodes.SUCCESS) revert ApprovalFailed(token1);
            }
        }
        if (withdrawHbar) {
            uint256 hbarBal = address(this).balance;
            if (hbarBal > 0) payable(vault).transfer(hbarBal);
        }
    }

    function decreaseLPPosition(
        uint256 tokenSN,
        uint128 liquidityToRemove,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        bool unwrapHbar
    ) external override onlyVault returns (uint256 amount0, uint256 amount1) {
        if (SAUCERSWAP_NFT_MANAGER == address(0)) revert SaucerSwapNotConfigured();
        LPPosition storage position = lpPositions[tokenSN];
        if (!position.active) revert LPPositionNotFound(tokenSN);
        if (liquidityToRemove > position.liquidity) revert InsufficientLiquidity(tokenSN, liquidityToRemove, position.liquidity);

        _decreaseLiquidityInternal(tokenSN, liquidityToRemove, amount0Min, amount1Min, deadline);
        (amount0, amount1) = _collectTokensInternal(tokenSN);
        position.liquidity -= liquidityToRemove;
        _withdrawToVault(position.token0, position.token1, amount0, amount1, unwrapHbar);
        emit LPPositionDecreased(tokenSN, liquidityToRemove, amount0, amount1);
        if (position.liquidity == 0) {
            position.active = false;
            emit LPPositionClosed(tokenSN);
        }
    }

    function collectLPFees(uint256 tokenSN, bool unwrapHbar) external override onlyVault returns (uint256 amount0, uint256 amount1) {
        if (SAUCERSWAP_NFT_MANAGER == address(0)) revert SaucerSwapNotConfigured();
        LPPosition storage position = lpPositions[tokenSN];
        if (!position.active) revert LPPositionNotFound(tokenSN);
        (amount0, amount1) = _collectTokensInternal(tokenSN);
        _withdrawToVault(position.token0, position.token1, amount0, amount1, unwrapHbar);
        emit LPFeesCollected(tokenSN, amount0, amount1);
    }

    function closeLPPosition(
        uint256 tokenSN,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        bool unwrapHbar
    ) external override onlyVault returns (uint256 amount0, uint256 amount1) {
        if (SAUCERSWAP_NFT_MANAGER == address(0)) revert SaucerSwapNotConfigured();
        LPPosition storage position = lpPositions[tokenSN];
        if (!position.active) revert LPPositionNotFound(tokenSN);
        uint128 currentLiquidity = position.liquidity;
        if (currentLiquidity > 0) _decreaseLiquidityInternal(tokenSN, currentLiquidity, amount0Min, amount1Min, deadline);
        (amount0, amount1) = _collectTokensInternal(tokenSN);
        hts.approveNFT(SAUCERSWAP_LP_NFT, SAUCERSWAP_NFT_MANAGER, int64(uint64(tokenSN)));
        ISaucerSwapV2NonfungiblePositionManager(SAUCERSWAP_NFT_MANAGER).burn(tokenSN);
        position.active = false;
        position.liquidity = 0;
        _withdrawToVault(position.token0, position.token1, amount0, amount1, unwrapHbar);
        emit LPPositionDecreased(tokenSN, currentLiquidity, amount0, amount1);
        emit LPPositionClosed(tokenSN);
    }

    function withdrawToVault(address token, uint256 amount) external override onlyVault {
        if (vault == address(0)) revert SaucerSwapNotConfigured();
        int64 rc = hts.transferToken(token, address(this), vault, int64(uint64(amount)));
        if (rc != HederaResponseCodes.SUCCESS) revert ApprovalFailed(token);
        emit WithdrawnToVault(token, amount);
    }

    function withdrawHbarToVault(uint256 amount) external override onlyVault {
        if (vault == address(0)) revert SaucerSwapNotConfigured();
        payable(vault).transfer(amount);
        emit WithdrawnHbarToVault(amount);
    }

    function addLiquidityV1ETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountHBARMin,
        uint256 deadline
    ) external payable override onlyVault returns (uint256 amountToken, uint256 amountHBAR, uint256 liquidity) {
        if (SAUCERSWAP_V1_ROUTER == address(0)) revert SaucerSwapNotConfigured();
        if (!_isCompositionToken(token)) revert TokenNotInComposition(token);
        (amountToken, amountHBAR, liquidity) = ISaucerSwapV1Router(SAUCERSWAP_V1_ROUTER).addLiquidityETH{value: msg.value}(token, amountTokenDesired, amountTokenMin, amountHBARMin, address(this), deadline);
    }

    function addLiquidityV1(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external override onlyVault returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (SAUCERSWAP_V1_ROUTER == address(0)) revert SaucerSwapNotConfigured();
        if (!_isCompositionToken(tokenA)) revert TokenNotInComposition(tokenA);
        if (!_isCompositionToken(tokenB)) revert TokenNotInComposition(tokenB);
        (amountA, amountB, liquidity) = ISaucerSwapV1Router(SAUCERSWAP_V1_ROUTER).addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline);
    }

    function removeLiquidityV1ETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountHBARMin,
        uint256 deadline
    ) external override onlyVault returns (uint256 amountToken, uint256 amountHBAR) {
        if (SAUCERSWAP_V1_ROUTER == address(0)) revert SaucerSwapNotConfigured();
        (amountToken, amountHBAR) = ISaucerSwapV1Router(SAUCERSWAP_V1_ROUTER).removeLiquidityETH(token, liquidity, amountTokenMin, amountHBARMin, address(this), deadline);
    }

    function removeLiquidityV1(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external override onlyVault returns (uint256 amountA, uint256 amountB) {
        if (SAUCERSWAP_V1_ROUTER == address(0)) revert SaucerSwapNotConfigured();
        (amountA, amountB) = ISaucerSwapV1Router(SAUCERSWAP_V1_ROUTER).removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, address(this), deadline);
    }

    function getHbarBalance() external view override returns (uint256) {
        return address(this).balance;
    }

    function getLPPositions() external view override returns (uint256[] memory) {
        return lpPositionSerials;
    }

    function getActiveLPPositionCount() external view override returns (uint256 count) {
        for (uint256 i = 0; i < lpPositionSerials.length; i++) {
            if (lpPositions[lpPositionSerials[i]].active) count++;
        }
    }

    function getLPPositionDetails(uint256 tokenSN) external view override returns (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity) {
        (, , token0, token1, fee, tickLower, tickUpper, liquidity, , , , ) = ISaucerSwapV2NonfungiblePositionManager(SAUCERSWAP_NFT_MANAGER).positions(tokenSN);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./HederaResponseCodes.sol";

// Proper HTS interface from documentation
interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
    function transferToken(address token, address from, address to, int64 amount) external returns (int64 responseCode);
    function mintToken(address token, int64 amount, bytes[] memory metadata) external returns (int64 responseCode, int64 newTotalSupply, int64[] memory serialNumbers);
    function burnToken(address token, int64 amount, int64[] memory serialNumbers) external returns (int64 responseCode, int64 newTotalSupply);
    function isAssociated(address account, address token) external returns (int64 responseCode, bool associated);
    function isToken(address token) external returns (int64 responseCode, bool isToken);
    function transferFrom(address token, address from, address to, int64 amount) external returns (int64 responseCode);
    function approveNFT(address token, address approved, int64 serialNumber) external returns (int64 responseCode);
    function approve(address token, address spender, uint256 amount) external returns (int64 responseCode);
}

// IERC20 interface for token approvals
interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IWHBAR {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice SaucerSwap V2 SwapRouter exactInput (tokens for tokens)
interface ISaucerSwapV2Router {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

import "./ILPModule.sol";

/**
 * @title DepositMinterV2
 * @dev Updated token minter that accepts 6-token deposits and mints proportional LYNX tokens
 * With governance-adjustable ratios for DAO parameter updates
 */
contract DepositMinterV2 is Initializable, UUPSUpgradeable {
    
    // HTS precompile interface
    IHederaTokenService private hts;
    address constant HTS_PRECOMPILE = 0x0000000000000000000000000000000000000167;
    
    // Token addresses (immutable after constructor)
    address public LYNX_TOKEN;
    address public WBTC_TOKEN;
    address public USDC_TOKEN;
    address public WETH_TOKEN;
    address public XSAUCE_TOKEN;
    // NOTE: SAUCE_TOKEN moved to end of storage to preserve upgrade compatibility
    
    // Access control
    address public ADMIN;
    address public GOVERNANCE;
    
    // Treasury address - where minted tokens go (usually the operator account)
    address public TREASURY;
    
    // LYNX token supply tracking (for staking reward calculations)
    uint256 public lynxTotalSupply;
    
    // Minting ratios (now adjustable via governance)
    uint256 public HBAR_RATIO = 59;      
    uint256 public WBTC_RATIO = 1;      
    uint256 public USDC_RATIO = 30;       
    uint256 public WETH_RATIO = 1; 
    uint256 public XSAUCE_RATIO = 9; 
    
    // stETH.h token address (Lido Staked ETH on Hedera)
    // NOTE: Added at end of storage to preserve slot positions for upgrades
    address public STETH_TOKEN;
    
    // ========== LP Module (VaultLPManager owns LP logic; WHBAR_TOKEN for createLPPosition) ==========
    address public WHBAR_TOKEN;
    bytes32 private __lpSlot1;
    bytes32 private __lpSlot2;
    bytes32 private __lpSlot3;
    bytes32 private __lpSlot4;
    bytes32 private __lpSlot5;
    bytes32 private __lpSlot6;
    
    // SAUCE_TOKEN - added at end of storage to preserve slot positions for upgrades
    address public SAUCE_TOKEN;
    
    // Burn reward vault: only this address can call transferHbarTo (pays burn rewards from vault HBAR)
    address public rewardVault;

    // LP contract: only this address receives LP delegations (vault transfers tokens here, then calls LP contract)
    address public LP_MODULE;

    // WHBAR_HELPER required for unwrap (SaucerSwap WHBAR uses withdraw(src,dst,wad); add at end for upgrade safety)
    address public WHBAR_HELPER;
    
    // Ratio bounds for safety
    uint256 public constant MIN_RATIO = 1;
    uint256 public constant MAX_RATIO = 100;
    
    // Token decimals (updated to match mainnet specifications)
    uint8 public constant USDC_DECIMALS = 6;
    uint8 public constant WETH_DECIMALS = 8;
    uint8 public constant XSAUCE_DECIMALS = 6; // Updated to 6 for mainnet
    uint8 public constant WBTC_DECIMALS = 8;
    uint8 public constant LYNX_DECIMALS = 8;
    
    // Events
    event TokensAssociated(address token, int64 responseCode);
    event TokensDeposited(
        address indexed user, 
        uint256 hbarAmount, 
        uint256 wbtcAmount, 
        uint256 usdcAmount, 
        uint256 wethAmount, 
        uint256 xsauceAmount
    );
    event TokensWithdrawn(
        address indexed user, 
        uint256 hbarAmount, 
        uint256 wbtcAmount, 
        uint256 usdcAmount, 
        uint256 wethAmount, 
        uint256 xsauceAmount
    );
    event LynxMinted(address indexed user, uint256 lynxAmount);
    event LynxBurned(address indexed user, uint256 lynxAmount);
    event MintAttempt(address indexed user, uint256 lynxAmount, uint256 lynxBaseUnits);
    event BurnAttempt(address indexed user, uint256 lynxAmount, uint256 lynxBaseUnits);
    event MintResult(int64 responseCode, int64 newTotalSupply);
    event BurnResult(int64 responseCode, int64 newTotalSupply);
    event TransferAttempt(address from, address to, uint256 amount);
    event TransferResult(int64 responseCode);
    event DepositsProcessed(address indexed user, uint256 totalTokensProcessed);
    event WithdrawalsProcessed(address indexed user, uint256 totalTokensProcessed);
    
    // Governance events
    event GovernanceAddressUpdated(address indexed oldGovernance, address indexed newGovernance);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AdminSet(address indexed oldAdmin, address indexed newAdmin);
    event RatiosUpdated(
        uint256 hbarRatio,
        uint256 wbtcRatio,
        uint256 usdcRatio,
        uint256 wethRatio,
        uint256 xsauceRatio,
        address indexed updatedBy
    );
    // Admin withdrawal event
    
    // Supply adjustment event
    event SupplyAdjusted(uint256 oldSupply, uint256 newSupply, uint256 newSupplyHuman);
    
    // LP Position management events
    event LPPositionCreated(
        uint256 indexed tokenSN,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );
    event LPPositionDecreased(
        uint256 indexed tokenSN,
        uint128 liquidityRemoved,
        uint256 amount0,
        uint256 amount1
    );
    event LPFeesCollected(
        uint256 indexed tokenSN,
        uint256 amount0,
        uint256 amount1
    );
    event LPPositionClosed(uint256 indexed tokenSN);
    event WhbarTransferredToLp(address indexed lpModule, uint256 amount);
    event TokenWithdrawnFromLp(address indexed token, uint256 amount);
    event SwapWhbarToUsdc(uint256 amountIn, uint256 amountOut);
    event TokenApprovalGranted(address indexed token, address indexed spender, uint256 amount);
    
    event RewardVaultUpdated(address indexed oldVault, address indexed newVault);
    
    // SaucerSwap V1 events
    event SaucerSwapV1ConfigUpdated(address router);
    event V1LiquidityAdded(address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB, uint256 liquidity);
    event V1LiquidityRemoved(address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB, uint256 liquidity);
    
    // Errors
    error OnlyAdmin();
    error OnlyGovernance();
    error InvalidAmount();
    error InvalidRatio(uint256 value);
    error TokenNotSet();
    error InsufficientDeposit(string tokenType, uint256 required, uint256 provided);
    error HTSOperationFailed(string operation, int64 responseCode);
    error GovernanceNotSet();
    error SaucerSwapNotConfigured();
    error TokenNotInComposition(address token);
    error ApprovalFailed(address token);
    error TransferFailed(address token);
    error StethNotSet();
    error HTSAborted();
    error ZeroSupply();
    error WhbarHelperNotSet();
    error TokenAddressZero();
    error InsufficientHbar();
    error InsufficientMintFee();
    error OnlyRewardVault();
    error InsufficientVaultHbar();
    error RouterNotSet();
    error LPModuleNotSet();
    error InvalidAdmin();
    
    modifier onlyAdmin() {
        if (msg.sender != ADMIN) {
            revert OnlyAdmin();
        }
        _;
    }
    
    modifier onlyGovernance() {
        if (msg.sender != GOVERNANCE) {
            revert OnlyGovernance();
        }
        _;
    }
    
    modifier onlyAdminOrGovernance() {
        if (msg.sender != ADMIN && msg.sender != GOVERNANCE) {
            revert OnlyGovernance();
        }
        _;
    }
    
    function initialize(
        address admin,
        address lynxToken,
        address wbtcToken,
        address usdcToken,
        address wethToken,
        address xsauceToken,
        address stethToken,
        address treasury,
        uint256 initialSupply
    ) public initializer {
        hts = IHederaTokenService(HTS_PRECOMPILE);
        LYNX_TOKEN = lynxToken;
        WBTC_TOKEN = wbtcToken;
        USDC_TOKEN = usdcToken;
        WETH_TOKEN = wethToken;
        XSAUCE_TOKEN = xsauceToken;
        STETH_TOKEN = stethToken;
        SAUCE_TOKEN = address(0x0000000000000000000000000000000000120f46); // Testnet SAUCE for LP testing
        ADMIN = admin; // Explicitly set admin address
        TREASURY = treasury; // Treasury address where minted tokens go
        lynxTotalSupply = initialSupply * (10 ** LYNX_DECIMALS); // Initialize supply in base units
        // GOVERNANCE starts as address(0) - admin must set it
        
        // Initialize hardcoded ratios in proxy storage
        HBAR_RATIO = 59;
        WBTC_RATIO = 1;
        USDC_RATIO = 30;
        WETH_RATIO = 1;
        XSAUCE_RATIO = 9;
    }
    
    /**
     * @dev Set governance address (admin only)
     */
    function setGovernanceAddress(address newGovernance) external onlyAdmin {
        address oldGovernance = GOVERNANCE;
        GOVERNANCE = newGovernance;
        emit GovernanceAddressUpdated(oldGovernance, newGovernance);
    }
    
    /**
     * @dev Set stETH token address (admin only, for post-upgrade configuration)
     */
    function setStethToken(address stethToken) external onlyAdmin {
        if (stethToken == address(0)) revert StethNotSet();
        STETH_TOKEN = stethToken;
    }

    /**
     * @dev Set treasury address (admin only). Must match LYNX token's treasury_account_id.
     * Use to fix misconfigured treasury (e.g. wrong network's operator EVM at deploy).
     */
    function setTreasury(address treasury) external onlyAdmin {
        if (treasury == address(0)) revert TokenNotSet();
        address oldTreasury = TREASURY;
        TREASURY = treasury;
        emit TreasuryUpdated(oldTreasury, treasury);
    }

    /**
     * @dev Set admin address (admin only). Use to transfer admin to KeyRing threshold for scheduled transactions.
     */
    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidAdmin();
        address oldAdmin = ADMIN;
        ADMIN = newAdmin;
        emit AdminSet(oldAdmin, newAdmin);
    }
    
    /**
     * @dev Update all ratios (governance only)
     */
    function updateRatios(
        uint256 hbarRatio,
        uint256 wbtcRatio,
        uint256 usdcRatio,
        uint256 wethRatio,
        uint256 xsauceRatio
    ) external onlyGovernance {
        if (GOVERNANCE == address(0)) revert GovernanceNotSet();
        
        _validateRatio(hbarRatio);
        _validateRatio(wbtcRatio);
        _validateRatio(usdcRatio);
        _validateRatio(wethRatio);
        _validateRatio(xsauceRatio);
        
        HBAR_RATIO = hbarRatio;
        WBTC_RATIO = wbtcRatio;
        USDC_RATIO = usdcRatio;
        WETH_RATIO = wethRatio;
        XSAUCE_RATIO = xsauceRatio;
        
        emit RatiosUpdated(hbarRatio, wbtcRatio, usdcRatio, wethRatio, xsauceRatio, msg.sender);
    }
    
    /**
     * @dev Emergency ratio update (admin only)
     */
    function adminUpdateRatios(
        uint256 hbarRatio,
        uint256 wbtcRatio,
        uint256 usdcRatio,
        uint256 wethRatio,
        uint256 xsauceRatio
    ) external onlyAdmin {
        _validateRatio(hbarRatio);
        _validateRatio(wbtcRatio);
        _validateRatio(usdcRatio);
        _validateRatio(wethRatio);
        _validateRatio(xsauceRatio);
        
        HBAR_RATIO = hbarRatio;
        WBTC_RATIO = wbtcRatio;
        USDC_RATIO = usdcRatio;
        WETH_RATIO = wethRatio;
        XSAUCE_RATIO = xsauceRatio;
        
        emit RatiosUpdated(hbarRatio, wbtcRatio, usdcRatio, wethRatio, xsauceRatio, msg.sender);
    }
    
    /**
     * @dev Get current ratios
     */
    function getCurrentRatios() external view returns (
        uint256 hbarRatio,
        uint256 wbtcRatio,
        uint256 usdcRatio,
        uint256 wethRatio,
        uint256 xsauceRatio
    ) {
        return (HBAR_RATIO, WBTC_RATIO, USDC_RATIO, WETH_RATIO, XSAUCE_RATIO);
    }
    
    /**
     * @dev Internal function to validate ratio bounds
     */
    function _validateRatio(uint256 value) internal pure {
        if (value < MIN_RATIO || value > MAX_RATIO) {
            revert InvalidRatio(value);
        }
    }
    
    /**
     * @dev Associate contract with all tokens - proper HTS pattern
     * TODO: Add onlyAdmin modifier for security
     */
    function associateTokens() external {
        // Associate with LYNX token
        int64 lynxResponse = hts.associateToken(address(this), LYNX_TOKEN);
        emit TokensAssociated(LYNX_TOKEN, lynxResponse);
        
        // Associate with WBTC token
        int64 wbtcResponse = hts.associateToken(address(this), WBTC_TOKEN);
        emit TokensAssociated(WBTC_TOKEN, wbtcResponse);
        
        // Associate with USDC token
        int64 usdcResponse = hts.associateToken(address(this), USDC_TOKEN);
        emit TokensAssociated(USDC_TOKEN, usdcResponse);
        
        // Associate with WETH token
        int64 wethResponse = hts.associateToken(address(this), WETH_TOKEN);
        emit TokensAssociated(WETH_TOKEN, wethResponse);
        
        // Associate with XSAUCE token
        int64 xsauceResponse = hts.associateToken(address(this), XSAUCE_TOKEN);
        emit TokensAssociated(XSAUCE_TOKEN, xsauceResponse);
        
        // Associate with stETH.h token (Lido Staked ETH on Hedera)
        int64 stethResponse = hts.associateToken(address(this), STETH_TOKEN);
        emit TokensAssociated(STETH_TOKEN, stethResponse);
        
        // Associate with SAUCE token (for LP testing on testnet)
        // Associate SAUCE token (state variable set in initialize)
        int64 sauceResponse = hts.associateToken(address(this), SAUCE_TOKEN);
        emit TokensAssociated(SAUCE_TOKEN, sauceResponse);
    }
    
    /**
     * @dev Check if contract is associated with all tokens
     */
    function checkAssociations() external returns (
        bool lynxAssociated,
        bool wbtcAssociated,
        bool usdcAssociated,
        bool wethAssociated,
        bool xsauceAssociated
    ) {
        (int64 lynxCode, bool lynxResult) = hts.isAssociated(address(this), LYNX_TOKEN);
        lynxAssociated = (lynxCode == HederaResponseCodes.SUCCESS && lynxResult);
        
        (int64 wbtcCode, bool wbtcResult) = hts.isAssociated(address(this), WBTC_TOKEN);
        wbtcAssociated = (wbtcCode == HederaResponseCodes.SUCCESS && wbtcResult);
        
        (int64 usdcCode, bool usdcResult) = hts.isAssociated(address(this), USDC_TOKEN);
        usdcAssociated = (usdcCode == HederaResponseCodes.SUCCESS && usdcResult);
        
        (int64 wethCode, bool wethResult) = hts.isAssociated(address(this), WETH_TOKEN);
        wethAssociated = (wethCode == HederaResponseCodes.SUCCESS && wethResult);
        
        (int64 xsauceCode, bool xsauceResult) = hts.isAssociated(address(this), XSAUCE_TOKEN);
        xsauceAssociated = (xsauceCode == HederaResponseCodes.SUCCESS && xsauceResult);
    }
    
    /**
     * @dev Calculate required deposits for a given LYNX amount (including staking rewards)
     */
    function calculateRequiredDeposits(uint256 lynxAmount) 
        external 
        view 
        returns (
            uint256 hbarRequired,
            uint256 wbtcRequired,
            uint256 usdcRequired,
            uint256 wethRequired,
            uint256 xsauceRequired
        ) 
    {
        // Calculate base HBAR requirement using ratio
        uint256 baseHbarRequired = lynxAmount * HBAR_RATIO * (10 ** 8) / 10; // HBAR per LYNX
        
        // Calculate staking rewards adjustment: (balance / supply) - baseHbarRequired
        uint256 stakingRewardAdjustment = 0;
        if (lynxTotalSupply > 0) {
            uint256 totalHbarPerLynx = (address(this).balance * lynxAmount) / lynxTotalSupply;
            if (totalHbarPerLynx > baseHbarRequired) {
                stakingRewardAdjustment = totalHbarPerLynx - baseHbarRequired;
            }
        }
        
        // Final HBAR required = base requirement + staking rewards
        hbarRequired = baseHbarRequired + stakingRewardAdjustment;
        
        // Other tokens use standard ratios (no staking rewards)
        wbtcRequired = lynxAmount * WBTC_RATIO * (10 ** WBTC_DECIMALS) / 1000000; // WBTC per LYNX
        usdcRequired = lynxAmount * USDC_RATIO * (10 ** USDC_DECIMALS) / 100; // USDC per LYNX
        wethRequired = lynxAmount * WETH_RATIO * (10 ** WETH_DECIMALS) / 100000; // WETH per LYNX
        xsauceRequired = lynxAmount * XSAUCE_RATIO * (10 ** XSAUCE_DECIMALS) / 10; // XSAUCE per LYNX
    }
    
    /**
     * @dev Calculate withdrawal amounts for burning LYNX tokens (including staking rewards)
     */
    function calculateWithdrawalAmounts(uint256 lynxAmount) 
        external 
        view 
        returns (
            uint256 hbarWithdrawal,
            uint256 wbtcWithdrawal,
            uint256 usdcWithdrawal,
            uint256 wethWithdrawal,
            uint256 xsauceWithdrawal
        ) 
    {
        // Base ratios only - rewards are claimed separately via operator
        hbarWithdrawal = lynxAmount * HBAR_RATIO * (10 ** 8) / 10; // HBAR per LYNX
        wbtcWithdrawal = lynxAmount * WBTC_RATIO * (10 ** WBTC_DECIMALS) / 1000000; // WBTC per LYNX
        usdcWithdrawal = lynxAmount * USDC_RATIO * (10 ** USDC_DECIMALS) / 100; // USDC per LYNX
        wethWithdrawal = lynxAmount * WETH_RATIO * (10 ** WETH_DECIMALS) / 100000; // WETH per LYNX
        xsauceWithdrawal = lynxAmount * XSAUCE_RATIO * (10 ** XSAUCE_DECIMALS) / 10; // XSAUCE per LYNX
    }
    
    /**
     * @dev Mint LYNX tokens by depositing all 5 tokens + HBAR
     */
    function mintWithDeposits(
        uint256 lynxAmount,
        uint256 wbtcAmount,
        uint256 usdcAmount,
        uint256 wethAmount,
        uint256 xsauceAmount
    ) external payable {
        _validateMintInputs(lynxAmount, wbtcAmount, usdcAmount, wethAmount, xsauceAmount);
        _processDeposits(wbtcAmount, usdcAmount, wethAmount, xsauceAmount);
        _mintAndTransfer(lynxAmount);
    }
    
    /**
     * @dev Step 1: Transfer LYNX tokens from user to contract for burning
     */
    function transferLynxForBurn(uint256 lynxAmount) external {
        _validateBurnInputs(lynxAmount);
        _transferLynxToContract(lynxAmount);
    }
    
    /**
     * @dev Step 2: Withdraw underlying assets to user (immediately after receiving LYNX)
     */
    function withdrawUnderlyingTokens(uint256 lynxAmount) external {
        _processWithdrawals(lynxAmount);
    }
    
    /**
     * @dev Step 3: Burn LYNX tokens (separate transaction to avoid blocking user withdrawals)
     */
    function burnLynxTokens(uint256 lynxAmount) external {
        _burnLynxTokens(lynxAmount);
    }

    /**
     * @dev Atomic burn: take LYNX from user, withdraw underlying to user, burn from treasury.
     * All in one transaction - user must approve this contract first.
     * Use this instead of the 3-step flow (transferLynxForBurn → withdrawUnderlyingTokens → burnLynxTokens)
     * to ensure transfer and burn happen in the same signing context (may fix HTS 326 on testnet).
     */
    function burn(uint256 lynxAmount) external {
        _validateBurnInputs(lynxAmount);
        _transferLynxToContract(lynxAmount);   // 1. Take LYNX from user → treasury
        _processWithdrawals(lynxAmount);       // 2. Withdraw underlying to user
        _burnLynxTokens(lynxAmount);           // 3. Burn from treasury
    }
    
    /**
     * @dev Internal function to validate burn inputs
     */
    function _validateBurnInputs(uint256 lynxAmount) internal view {
        if (lynxAmount == 0) revert InvalidAmount();
        if (LYNX_TOKEN == address(0)) revert TokenNotSet();
        
        // Note: User must have sufficient LYNX balance and allowance
        // The actual balance check will happen during the burn operation
    }

    /**
     * @dev Internal function to validate mint inputs
     */
    function _validateMintInputs(
        uint256 lynxAmount,
        uint256 wbtcAmount,
        uint256 usdcAmount,
        uint256 wethAmount,
        uint256 xsauceAmount
    ) internal view {
        if (lynxAmount == 0) revert InvalidAmount();
        if (LYNX_TOKEN == address(0)) revert TokenNotSet();
        if (WBTC_TOKEN == address(0)) revert TokenNotSet();
        if (USDC_TOKEN == address(0)) revert TokenNotSet();
        if (WETH_TOKEN == address(0)) revert TokenNotSet();
        if (XSAUCE_TOKEN == address(0)) revert TokenNotSet();
        
        // Calculate required amounts
        (
            uint256 hbarRequired,
            uint256 wbtcRequired,
            uint256 usdcRequired,
            uint256 wethRequired,
            uint256 xsauceRequired
        ) = this.calculateRequiredDeposits(lynxAmount);
        
        // Validate deposits
        if (msg.value < hbarRequired) {
            revert InsufficientDeposit("HBAR", hbarRequired, msg.value);
        }
        if (wbtcAmount < wbtcRequired) {
            revert InsufficientDeposit("WBTC", wbtcRequired, wbtcAmount);
        }
        if (usdcAmount < usdcRequired) {
            revert InsufficientDeposit("USDC", usdcRequired, usdcAmount);
        }
        if (wethAmount < wethRequired) {
            revert InsufficientDeposit("WETH", wethRequired, wethAmount);
        }
        if (xsauceAmount < xsauceRequired) {
            revert InsufficientDeposit("XSAUCE", xsauceRequired, xsauceAmount);
        }
    }
    
    /**
     * @dev Internal function to process token deposits using HTS.
     * Uses transferToken (not transferFrom) - same allowance semantics per v0.35.2, but transferFrom
     * fails on testnet with CryptoApproveAllowance; transferToken works. User must approve this contract first.
     */
    function _processDeposits(
        uint256 wbtcAmount,
        uint256 usdcAmount,
        uint256 wethAmount,
        uint256 xsauceAmount
    ) internal {
        uint256 tokensProcessed = 0;
        
        // Pull WBTC from user (allowance: owner = msg.sender, spender = this contract)
        int64 wbtcResponse = hts.transferToken(WBTC_TOKEN, msg.sender, address(this), int64(uint64(wbtcAmount)));
        if (wbtcResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("WBTC transfer", wbtcResponse);
        }
        tokensProcessed++;
        
        // Pull USDC from user
        int64 usdcResponse = hts.transferToken(USDC_TOKEN, msg.sender, address(this), int64(uint64(usdcAmount)));
        if (usdcResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("USDC transfer", usdcResponse);
        }
        tokensProcessed++;
        
        // Pull WETH from user
        int64 wethResponse = hts.transferToken(WETH_TOKEN, msg.sender, address(this), int64(uint64(wethAmount)));
        if (wethResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("WETH transfer", wethResponse);
        }
        tokensProcessed++;
        
        // Pull XSAUCE from user
        int64 xsauceResponse = hts.transferToken(XSAUCE_TOKEN, msg.sender, address(this), int64(uint64(xsauceAmount)));
        if (xsauceResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("XSAUCE transfer", xsauceResponse);
        }
        tokensProcessed++;
        
        emit DepositsProcessed(msg.sender, tokensProcessed);
        emit TokensDeposited(msg.sender, msg.value, wbtcAmount, usdcAmount, wethAmount, xsauceAmount);
    }
    
    /**
     * @dev Internal function to mint and transfer LYNX tokens using HTS
     */
    function _mintAndTransfer(uint256 lynxAmount) internal {
        uint256 lynxBaseUnits = lynxAmount * (10 ** LYNX_DECIMALS);
        emit MintAttempt(msg.sender, lynxAmount, lynxBaseUnits);

        bytes[] memory metadata = new bytes[](0);
        (int64 mintResponse, int64 newTotalSupply, ) = hts.mintToken(LYNX_TOKEN, int64(uint64(lynxBaseUnits)), metadata);
        emit MintResult(mintResponse, newTotalSupply);

        if (mintResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX mint", mintResponse);
        }
        
        // Update our local supply tracking
        lynxTotalSupply += lynxBaseUnits;
        
        emit TransferAttempt(TREASURY, msg.sender, lynxBaseUnits);
        
        // Transfer minted tokens from treasury to user using transferToken (transferFrom fails on testnet; same allowance semantics)
        int64 transferResponse = hts.transferToken(LYNX_TOKEN, TREASURY, msg.sender, int64(uint64(lynxBaseUnits)));
        
        emit TransferResult(transferResponse);
        
        if (transferResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX transfer to user", transferResponse);
        }
        
        emit LynxMinted(msg.sender, lynxAmount);
    }
    
    /**
     * @dev Internal function to transfer LYNX tokens from user to treasury (for burning)
     */
    function _transferLynxToContract(uint256 lynxAmount) internal {
        // Convert to base units for transfer
        uint256 lynxBaseUnits = lynxAmount * (10 ** LYNX_DECIMALS);
        
        emit BurnAttempt(msg.sender, lynxAmount, lynxBaseUnits);
        
        // Transfer LYNX from user to treasury using transferToken (transferFrom fails on testnet; same allowance semantics)
        int64 code = hts.transferToken(LYNX_TOKEN, msg.sender, TREASURY, int64(uint64(lynxBaseUnits)));
        emit TransferResult(code);
        if (code != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX transfer to treasury", code);
        }
    }
    
    /**
     * @dev Internal function to burn LYNX tokens from treasury (burnToken burns from treasury when contract has supply key)
     */
    function _burnLynxTokens(uint256 lynxAmount) internal {
        // Convert to base units for burning
        uint256 lynxBaseUnits = lynxAmount * (10 ** LYNX_DECIMALS);
        
        // Burn the LYNX tokens from treasury (contract has supply key, burnToken should burn from treasury)
        (int64 burnResponse, int64 newTotalSupply) = hts.burnToken(LYNX_TOKEN, int64(uint64(lynxBaseUnits)), new int64[](0));
        
        emit BurnResult(burnResponse, newTotalSupply);
        
        if (burnResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX burn", burnResponse);
        }
        
        // Update our local supply tracking
        lynxTotalSupply -= lynxBaseUnits;
        
        emit LynxBurned(msg.sender, lynxAmount);
    }
    
    /**
     * @dev Internal function to process token withdrawals to user
     */
    function _processWithdrawals(uint256 lynxAmount) internal {
        // Calculate withdrawal amounts
        (
            uint256 hbarWithdrawal,
            uint256 wbtcWithdrawal,
            uint256 usdcWithdrawal,
            uint256 wethWithdrawal,
            uint256 xsauceWithdrawal
        ) = this.calculateWithdrawalAmounts(lynxAmount);
        
        uint256 tokensProcessed = 0;
        
        // Transfer WBTC tokens to user
        if (wbtcWithdrawal > 0) {
            int64 wbtcResponse = hts.transferToken(WBTC_TOKEN, address(this), msg.sender, int64(uint64(wbtcWithdrawal)));
            if (wbtcResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("WBTC transfer", wbtcResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer USDC tokens to user
        if (usdcWithdrawal > 0) {
            int64 usdcResponse = hts.transferToken(USDC_TOKEN, address(this), msg.sender, int64(uint64(usdcWithdrawal)));
            if (usdcResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("USDC transfer", usdcResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer WETH tokens to user
        if (wethWithdrawal > 0) {
            int64 wethResponse = hts.transferToken(WETH_TOKEN, address(this), msg.sender, int64(uint64(wethWithdrawal)));
            if (wethResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("WETH transfer", wethResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer XSAUCE tokens to user
        if (xsauceWithdrawal > 0) {
            int64 xsauceResponse = hts.transferToken(XSAUCE_TOKEN, address(this), msg.sender, int64(uint64(xsauceWithdrawal)));
            if (xsauceResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("XSAUCE transfer", xsauceResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer HBAR to user (if any)
        if (hbarWithdrawal > 0) {
            payable(msg.sender).transfer(hbarWithdrawal);
        }
        
        emit WithdrawalsProcessed(msg.sender, tokensProcessed);
        emit TokensWithdrawn(msg.sender, hbarWithdrawal, wbtcWithdrawal, usdcWithdrawal, wethWithdrawal, xsauceWithdrawal);
    }
    
    /**
     * @dev Get contract's HBAR balance
     */
    function getHbarBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    
    // Allow contract to receive HBAR
    receive() external payable {}

    /**
     * @dev Admin function to adjust the LYNX total supply tracking
     * This allows fixing supply discrepancies without re-deployment
     */
    function adjustSupply(uint256 newSupply) external onlyAdmin {
        if (newSupply == 0) revert ZeroSupply();
        uint256 oldSupply = lynxTotalSupply;
        lynxTotalSupply = newSupply * (10 ** LYNX_DECIMALS);
        emit SupplyAdjusted(oldSupply, lynxTotalSupply, newSupply);
    }

    // ========== LP (thin wrappers – logic in VaultLPManager) ==========

    function setLPManager(address _lpModule) external onlyAdmin {
        LP_MODULE = _lpModule;
    }

    function configureSaucerSwap(address, address, address whbar, address whbarHelper) external onlyAdmin {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        WHBAR_TOKEN = whbar;
        WHBAR_HELPER = whbarHelper;
    }

    function associateSaucerSwapTokens() external {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        ILPModule(LP_MODULE).associateSaucerSwapTokens();
    }

    function associateTokenAdmin(address token) external onlyAdmin {
        if (token == address(0)) revert TokenAddressZero();
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        ILPModule(LP_MODULE).associateTokenAdmin(token);
    }

    function approveSaucerSwapSpending(address token, uint256 amount) external onlyAdmin {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        ILPModule(LP_MODULE).approveSaucerSwapSpending(token, amount);
    }

    function createLPPosition(ILPModule.CreateLPParams calldata params) external payable onlyAdmin returns (uint256 tokenSN, uint128 liquidity, uint256 amount0, uint256 amount1) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        if (params.token0 != WHBAR_TOKEN) hts.approve(params.token0, LP_MODULE, params.amount0Desired);
        if (params.token1 != WHBAR_TOKEN) hts.approve(params.token1, LP_MODULE, params.amount1Desired);
        uint256 hbar = 1e8;
        if (params.token0 == WHBAR_TOKEN) hbar += params.amount0Desired;
        if (params.token1 == WHBAR_TOKEN) hbar += params.amount1Desired;
        (tokenSN, liquidity, amount0, amount1) = ILPModule(LP_MODULE).createLPPosition{value: hbar}(params);
        emit LPPositionCreated(tokenSN, params.token0, params.token1, params.fee, params.tickLower, params.tickUpper, liquidity, amount0, amount1);
    }

    function decreaseLPPosition(uint256 tokenSN, uint128 liquidityToRemove, uint256 amount0Min, uint256 amount1Min, uint256 deadline, bool unwrapHbar) external onlyAdmin returns (uint256 amount0, uint256 amount1) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amount0, amount1) = ILPModule(LP_MODULE).decreaseLPPosition(tokenSN, liquidityToRemove, amount0Min, amount1Min, deadline, unwrapHbar);
        emit LPPositionDecreased(tokenSN, liquidityToRemove, amount0, amount1);
    }

    function collectLPFees(uint256 tokenSN, bool unwrapHbar) external onlyAdmin returns (uint256 amount0, uint256 amount1) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amount0, amount1) = ILPModule(LP_MODULE).collectLPFees(tokenSN, unwrapHbar);
        emit LPFeesCollected(tokenSN, amount0, amount1);
    }

    function closeLPPosition(uint256 tokenSN, uint256 amount0Min, uint256 amount1Min, uint256 deadline, bool unwrapHbar) external onlyAdmin returns (uint256 amount0, uint256 amount1) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amount0, amount1) = ILPModule(LP_MODULE).closeLPPosition(tokenSN, amount0Min, amount1Min, deadline, unwrapHbar);
        emit LPPositionClosed(tokenSN);
    }

    /**
     * @dev Pull token from LP module back to proxy (admin only). Use to recover WHBAR etc.
     */
    function withdrawFromLpManager(address token, uint256 amount) external onlyAdmin returns (uint256) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        if (token == address(0)) revert TokenAddressZero();
        ILPModule(LP_MODULE).withdrawToVault(token, amount);
        emit TokenWithdrawnFromLp(token, amount);
        return amount;
    }

    /**
     * @dev Swap proxy's WHBAR for USDC via SaucerSwap V2 router (admin only).
     * @param amountIn WHBAR amount (8 decimals)
     * @param amountOutMinimum Min USDC to receive (6 decimals); use 0 to accept any.
     * @param swapRouter SaucerSwap V2 SwapRouter EVM address (mainnet: 0x...3c3f6e)
     */
    function swapWhbarToUsdc(uint256 amountIn, uint256 amountOutMinimum, address swapRouter) external onlyAdmin returns (uint256 amountOut) {
        if (swapRouter == address(0) || WHBAR_TOKEN == address(0) || USDC_TOKEN == address(0)) revert TokenAddressZero();
        uint256 bal = IWHBAR(WHBAR_TOKEN).balanceOf(address(this));
        if (amountIn > bal) amountIn = bal;
        if (amountIn == 0) return 0;
        int64 rc = hts.approve(WHBAR_TOKEN, swapRouter, amountIn);
        if (rc != HederaResponseCodes.SUCCESS) revert ApprovalFailed(WHBAR_TOKEN);
        // Path: WHBAR -> fee 1500 (0.15%) -> USDC
        bytes memory path = abi.encodePacked(
            WHBAR_TOKEN,
            uint24(1500),
            USDC_TOKEN
        );
        ISaucerSwapV2Router.ExactInputParams memory params = ISaucerSwapV2Router.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp + 600,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum
        });
        amountOut = ISaucerSwapV2Router(swapRouter).exactInput(params);
        emit SwapWhbarToUsdc(amountIn, amountOut);
        return amountOut;
    }

    /**
     * @dev Transfer proxy's WHBAR to LP module for use in LP positions (admin only).
     */
    function transferWhbarToLpManager(uint256 amount) external onlyAdmin returns (uint256) {
        if (WHBAR_TOKEN == address(0) || LP_MODULE == address(0)) revert LPModuleNotSet();
        uint256 bal = IWHBAR(WHBAR_TOKEN).balanceOf(address(this));
        if (amount > bal) amount = bal;
        if (amount == 0) return 0;
        int64 rc = hts.transferToken(WHBAR_TOKEN, address(this), LP_MODULE, int64(uint64(amount)));
        if (rc != HederaResponseCodes.SUCCESS) revert ApprovalFailed(WHBAR_TOKEN);
        emit WhbarTransferredToLp(LP_MODULE, amount);
        return amount;
    }

    /**
     * @dev Set burn reward vault (admin only). Only this contract can call transferHbarTo.
     */
    function setRewardVault(address _rewardVault) external onlyAdmin {
        address old = rewardVault;
        rewardVault = _rewardVault;
        emit RewardVaultUpdated(old, _rewardVault);
    }

    /**
     * @dev Send HBAR to recipient. Only callable by rewardVault (BurnRewardVault).
     */
    function transferHbarTo(address to, uint256 amount) external {
        if (msg.sender != rewardVault) revert OnlyRewardVault();
        if (address(this).balance < amount) revert InsufficientVaultHbar();
        payable(to).transfer(amount);
    }

    function getLPPositions() external view returns (uint256[] memory) {
        if (LP_MODULE == address(0)) return new uint256[](0);
        return ILPModule(LP_MODULE).getLPPositions();
    }

    function getActiveLPPositionCount() external view returns (uint256 count) {
        if (LP_MODULE == address(0)) return 0;
        return ILPModule(LP_MODULE).getActiveLPPositionCount();
    }

    function getLPPositionDetails(uint256 tokenSN) external view returns (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity) {
        if (LP_MODULE == address(0)) return (address(0), address(0), 0, 0, 0, 0);
        return ILPModule(LP_MODULE).getLPPositionDetails(tokenSN);
    }

    function configureSaucerSwapV1(address router) external onlyAdmin {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        ILPModule(LP_MODULE).configureSaucerSwapV1(router);
        emit SaucerSwapV1ConfigUpdated(router);
    }

    function approveSaucerSwapV1Spending(address token, uint256 amount) external onlyAdmin {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        ILPModule(LP_MODULE).approveSaucerSwapV1Spending(token, amount);
        emit TokenApprovalGranted(token, LP_MODULE, amount);
    }

    function addLiquidityV1ETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountHBARMin,
        uint256 deadline
    ) external payable onlyAdmin returns (uint256 amountToken, uint256 amountHBAR, uint256 liquidity) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amountToken, amountHBAR, liquidity) = ILPModule(LP_MODULE).addLiquidityV1ETH{value: msg.value}(token, amountTokenDesired, amountTokenMin, amountHBARMin, deadline);
        emit V1LiquidityAdded(token, address(0), amountToken, amountHBAR, liquidity);
    }

    function addLiquidityV1(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external onlyAdmin returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amountA, amountB, liquidity) = ILPModule(LP_MODULE).addLiquidityV1(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, deadline);
        emit V1LiquidityAdded(tokenA, tokenB, amountA, amountB, liquidity);
    }

    function removeLiquidityV1ETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountHBARMin,
        uint256 deadline
    ) external onlyAdmin returns (uint256 amountToken, uint256 amountHBAR) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amountToken, amountHBAR) = ILPModule(LP_MODULE).removeLiquidityV1ETH(token, liquidity, amountTokenMin, amountHBARMin, deadline);
        emit V1LiquidityRemoved(token, address(0), amountToken, amountHBAR, liquidity);
    }

    function removeLiquidityV1(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external onlyAdmin returns (uint256 amountA, uint256 amountB) {
        if (LP_MODULE == address(0)) revert LPModuleNotSet();
        (amountA, amountB) = ILPModule(LP_MODULE).removeLiquidityV1(tokenA, tokenB, liquidity, amountAMin, amountBMin, deadline);
        emit V1LiquidityRemoved(tokenA, tokenB, amountA, amountB, liquidity);
    }

    /**
     * @dev Required for UUPS upgrade pattern
     * Only the admin can authorize upgrades
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {
        // Admin check is handled by onlyAdmin modifier
    }
} 
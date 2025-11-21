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
}

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
    event RatiosUpdated(
        uint256 hbarRatio,
        uint256 wbtcRatio,
        uint256 usdcRatio,
        uint256 wethRatio,
        uint256 xsauceRatio,
        address indexed updatedBy
    );
    // Admin withdrawal event
    event AdminTokenWithdrawal(address indexed token, address indexed to, uint256 amount, string reason);
    
    // Supply adjustment event
    event SupplyAdjusted(uint256 oldSupply, uint256 newSupply, uint256 newSupplyHuman);
    
    // Errors
    error OnlyAdmin();
    error OnlyGovernance();
    error InvalidAmount();
    error InvalidRatio(string ratioName, uint256 value);
    error TokenNotSet(string tokenType);
    error InsufficientDeposit(string tokenType, uint256 required, uint256 provided);
    error HTSOperationFailed(string operation, int64 responseCode);
    error GovernanceNotSet();
    
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
        address treasury,
        uint256 initialSupply
    ) public initializer {
        hts = IHederaTokenService(HTS_PRECOMPILE);
        LYNX_TOKEN = lynxToken;
        WBTC_TOKEN = wbtcToken;
        USDC_TOKEN = usdcToken;
        WETH_TOKEN = wethToken;
        XSAUCE_TOKEN = xsauceToken;
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
        
        _validateRatio("HBAR", hbarRatio);
        _validateRatio("WBTC", wbtcRatio);
        _validateRatio("USDC", usdcRatio);
        _validateRatio("WETH", wethRatio);
        _validateRatio("XSAUCE", xsauceRatio);
        
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
        _validateRatio("HBAR", hbarRatio);
        _validateRatio("WBTC", wbtcRatio);
        _validateRatio("USDC", usdcRatio);
        _validateRatio("WETH", wethRatio);
        _validateRatio("XSAUCE", xsauceRatio);
        
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
    function _validateRatio(string memory ratioName, uint256 value) internal pure {
        if (value < MIN_RATIO || value > MAX_RATIO) {
            revert InvalidRatio(ratioName, value);
        }
    }
    
    /**
     * @dev Associate contract with all tokens - proper HTS pattern
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
        // Calculate base HBAR withdrawal using ratio
        uint256 baseHbarWithdrawal = lynxAmount * HBAR_RATIO * (10 ** 8) / 10; // HBAR per LYNX
        
        // Calculate staking rewards adjustment: (balance / supply) - baseHbarRequired
        uint256 stakingRewardAdjustment = 0;
        if (lynxTotalSupply > 0) {
            uint256 totalHbarPerLynx = (address(this).balance * lynxAmount) / lynxTotalSupply;
            if (totalHbarPerLynx > baseHbarWithdrawal) {
                stakingRewardAdjustment = totalHbarPerLynx - baseHbarWithdrawal;
            }
        }
        
        // Final HBAR withdrawal = base withdrawal + staking rewards
        hbarWithdrawal = baseHbarWithdrawal + stakingRewardAdjustment;
        
        // Other tokens use standard ratios (no staking rewards)
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
     * @dev Internal function to validate burn inputs
     */
    function _validateBurnInputs(uint256 lynxAmount) internal view {
        if (lynxAmount == 0) revert InvalidAmount();
        if (LYNX_TOKEN == address(0)) revert TokenNotSet("LYNX");
        
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
        if (LYNX_TOKEN == address(0)) revert TokenNotSet("LYNX");
        if (WBTC_TOKEN == address(0)) revert TokenNotSet("WBTC");
        if (USDC_TOKEN == address(0)) revert TokenNotSet("USDC");
        if (WETH_TOKEN == address(0)) revert TokenNotSet("WETH");
        if (XSAUCE_TOKEN == address(0)) revert TokenNotSet("XSAUCE");
        
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
     * @dev Internal function to process token deposits using HTS
     */
    function _processDeposits(
        uint256 wbtcAmount,
        uint256 usdcAmount,
        uint256 wethAmount,
        uint256 xsauceAmount
    ) internal {
        uint256 tokensProcessed = 0;
        
        // Transfer WBTC tokens using HTS
        int64 wbtcResponse = hts.transferToken(WBTC_TOKEN, msg.sender, address(this), int64(uint64(wbtcAmount)));
        if (wbtcResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("WBTC transfer", wbtcResponse);
        }
        tokensProcessed++;
        
        // Transfer USDC tokens using HTS
        int64 usdcResponse = hts.transferToken(USDC_TOKEN, msg.sender, address(this), int64(uint64(usdcAmount)));
        if (usdcResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("USDC transfer", usdcResponse);
        }
        tokensProcessed++;
        
        // Transfer WETH tokens using HTS
        int64 wethResponse = hts.transferToken(WETH_TOKEN, msg.sender, address(this), int64(uint64(wethAmount)));
        if (wethResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("WETH transfer", wethResponse);
        }
        tokensProcessed++;
        
        // Transfer XSAUCE tokens using HTS
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
        // Convert to base units for minting
        uint256 lynxBaseUnits = lynxAmount * (10 ** LYNX_DECIMALS);
        
        emit MintAttempt(msg.sender, lynxAmount, lynxBaseUnits);
        
        // Note: User must be associated with LYNX token before calling this function
        
        // Mint LYNX tokens
        bytes[] memory metadata = new bytes[](0);
        (int64 mintResponse, int64 newTotalSupply, ) = hts.mintToken(LYNX_TOKEN, int64(uint64(lynxBaseUnits)), metadata);
        
        emit MintResult(mintResponse, newTotalSupply);
        
        if (mintResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX mint", mintResponse);
        }
        
        // Update our local supply tracking
        lynxTotalSupply += lynxBaseUnits;
        
        emit TransferAttempt(TREASURY, msg.sender, lynxBaseUnits);
        
        // Transfer minted tokens from treasury to user using transferToken
        // Note: Minted tokens go to the treasury account, so we transfer from treasury
        int64 transferResponse = hts.transferToken(LYNX_TOKEN, TREASURY, msg.sender, int64(uint64(lynxBaseUnits)));
        
        emit TransferResult(transferResponse);
        
        if (transferResponse != HederaResponseCodes.SUCCESS) {
            revert HTSOperationFailed("LYNX transfer from treasury", transferResponse);
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
        
        // Transfer LYNX tokens from user to treasury (burnToken burns from treasury when contract has supply key)
        try hts.transferToken(LYNX_TOKEN, msg.sender, TREASURY, int64(uint64(lynxBaseUnits))) returns (int64 code) {
            emit TransferResult(code);
            if (code != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("LYNX transfer to treasury for burn", code);
            }
        } catch {
            revert("HTS precompile aborted before returning");
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
                revert HTSOperationFailed("WBTC withdrawal", wbtcResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer USDC tokens to user
        if (usdcWithdrawal > 0) {
            int64 usdcResponse = hts.transferToken(USDC_TOKEN, address(this), msg.sender, int64(uint64(usdcWithdrawal)));
            if (usdcResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("USDC withdrawal", usdcResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer WETH tokens to user
        if (wethWithdrawal > 0) {
            int64 wethResponse = hts.transferToken(WETH_TOKEN, address(this), msg.sender, int64(uint64(wethWithdrawal)));
            if (wethResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("WETH withdrawal", wethResponse);
            }
            tokensProcessed++;
        }
        
        // Transfer XSAUCE tokens to user
        if (xsauceWithdrawal > 0) {
            int64 xsauceResponse = hts.transferToken(XSAUCE_TOKEN, address(this), msg.sender, int64(uint64(xsauceWithdrawal)));
            if (xsauceResponse != HederaResponseCodes.SUCCESS) {
                revert HTSOperationFailed("XSAUCE withdrawal", xsauceResponse);
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
        require(newSupply > 0, "Supply must be greater than zero");
        uint256 oldSupply = lynxTotalSupply;
        lynxTotalSupply = newSupply * (10 ** LYNX_DECIMALS);
        emit SupplyAdjusted(oldSupply, lynxTotalSupply, newSupply);
    }

    /**
     * @dev Required for UUPS upgrade pattern
     * Only the admin can authorize upgrades
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {
        // Admin check is handled by onlyAdmin modifier
    }
} 
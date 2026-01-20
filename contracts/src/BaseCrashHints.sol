// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BaseCrashHints
 * @notice Contract for purchasing hints in Base Crash game.
 *         Emits events for off-chain verification, forwards ETH to treasury.
 */
contract BaseCrashHints is Ownable {
    /// @notice Treasury address that receives payments
    address public treasury;
    
    /// @notice Price per hint pack in wei
    uint256 public priceWei;
    
    /// @notice Number of hints per pack (constant)
    uint256 public constant PACK_SIZE = 3;

    /// @notice Emitted when hints are purchased
    event HintsPurchased(
        address indexed buyer,
        bytes32 indexed runId,
        uint256 amountWei,
        uint256 hints
    );

    /// @notice Emitted when treasury is updated
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Emitted when price is updated
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    error InsufficientPayment(uint256 sent, uint256 required);
    error TransferFailed();
    error ZeroAddress();

    constructor(address _treasury, uint256 _priceWei) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        priceWei = _priceWei;
    }

    /**
     * @notice Purchase a pack of hints
     * @param runId The game run ID (bytes32 hash of the run UUID)
     */
    function buyHints(bytes32 runId) external payable {
        if (msg.value < priceWei) {
            revert InsufficientPayment(msg.value, priceWei);
        }

        // Emit event BEFORE external call (CEI pattern)
        emit HintsPurchased(msg.sender, runId, msg.value, PACK_SIZE);

        // Forward ETH to treasury
        (bool success, ) = treasury.call{value: msg.value}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Update treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    /**
     * @notice Update hint pack price
     * @param _priceWei New price in wei
     */
    function setPrice(uint256 _priceWei) external onlyOwner {
        uint256 old = priceWei;
        priceWei = _priceWei;
        emit PriceUpdated(old, _priceWei);
    }

    /**
     * @notice Get pack size (for frontend convenience)
     */
    function packSize() external pure returns (uint256) {
        return PACK_SIZE;
    }
}

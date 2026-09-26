// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Only the registry functions we need (Hako's registry and each user's registry)
interface IRegistryLite {
    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
    function findOwner(string calldata label) external view returns (address);
}

/// The Permissioned Resolver only answers reads through resolve(name, data) (ENSIP-10),
/// where data is an encoded text(node, key) call
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// Runs Hako tasks. Every run re-reads the task's ENS name, so a deleted,
/// expired or paused task can never pay out, whoever calls execute().
contract TaskExecutor {
    using SafeERC20 for IERC20;

    IRegistryLite public immutable HAKO_REGISTRY; // registry of hako-箱.eth
    bytes32 public immutable PARENT_NODE;         // namehash("hako-箱.eth")
    bytes public PARENT_DNS;                      // DNS-encoded "hako-箱.eth"

    /// namehash of the task name => timestamp of the last run
    mapping(bytes32 => uint256) public lastRun;

    error UserNotFound(string userLabel);
    error TaskNotFound(string taskLabel);
    error NotUsersTask();
    error TaskNotActive();
    error TooEarly(uint256 nextRunAt);
    error BadRecord(string key);

    event Executed(
        bytes32 indexed taskKey,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount,
        string taskLabel,
        string userLabel
    );

    struct Task {
        address owner;
        address token;
        address recipient;
        uint256 amount;
        uint256 interval;
        bytes32 key;
    }

    constructor(IRegistryLite hakoRegistry, bytes32 parentNode, bytes memory parentDns) {
        HAKO_REGISTRY = hakoRegistry;
        PARENT_NODE = parentNode;
        PARENT_DNS = parentDns;
    }

    /// Anyone can call this (your cron, the "Run now" button, a judge).
    /// It only pays if the ENS name says so.
    function execute(string calldata userLabel, string calldata taskLabel) external {
        Task memory t = _load(userLabel, taskLabel);

        uint256 last = lastRun[t.key];
        if (last != 0 && block.timestamp < last + t.interval) revert TooEarly(last + t.interval);
        lastRun[t.key] = block.timestamp;

        IERC20(t.token).safeTransferFrom(t.owner, t.recipient, t.amount);
        emit Executed(t.key, t.owner, t.recipient, t.token, t.amount, taskLabel, userLabel);
    }

    /// Key used in lastRun (the task's namehash), so the frontend can show "last ran"
    function taskKey(string calldata userLabel, string calldata taskLabel) public view returns (bytes32) {
        return _node(userLabel, taskLabel);
    }

    // ---------------- internal ----------------

    function _load(string calldata userLabel, string calldata taskLabel) internal view returns (Task memory t) {
        // 1. The user's name must exist under hako-箱.eth
        address userOwner = HAKO_REGISTRY.findOwner(userLabel);
        address userRegistry = HAKO_REGISTRY.getSubregistry(userLabel);
        if (userOwner == address(0) || userRegistry == address(0)) revert UserNotFound(userLabel);

        // 2. The task's name must exist (not deleted, not expired)
        IRegistryLite reg = IRegistryLite(userRegistry);
        address taskOwner = reg.findOwner(taskLabel);
        if (taskOwner == address(0)) revert TaskNotFound(taskLabel);

        // 3. Money only ever leaves the wallet that owns the user's name
        if (taskOwner != userOwner) revert NotUsersTask();

        address resolverAddr = reg.getResolver(taskLabel);
        if (resolverAddr == address(0)) revert TaskNotFound(taskLabel);
        IExtendedResolver resolver = IExtendedResolver(resolverAddr);

        // 4. Read the task's settings from ENS
        bytes memory name = _dnsName(userLabel, taskLabel);
        bytes32 node = _node(userLabel, taskLabel);
        if (keccak256(bytes(_text(resolver, name, node, "task.status"))) != keccak256("active")) revert TaskNotActive();

        t.owner = userOwner;
        t.token = _parseAddress(_text(resolver, name, node, "task.token"), "task.token");
        t.recipient = _parseAddress(_text(resolver, name, node, "task.recipient"), "task.recipient");
        t.amount = _parseUint(_text(resolver, name, node, "task.amount"), "task.amount");
        t.interval = _parseUint(_text(resolver, name, node, "task.interval"), "task.interval");
        t.key = node;
    }

    /// Reads one text record through resolve(name, text(node, key))
    function _text(IExtendedResolver resolver, bytes memory name, bytes32 node, string memory key)
        internal
        view
        returns (string memory)
    {
        bytes memory out = resolver.resolve(name, abi.encodeWithSignature("text(bytes32,string)", node, key));
        if (out.length == 0) return "";
        return abi.decode(out, (string));
    }

    /// "rent" + "alice" => DNS-encoded "rent.alice.hako-箱.eth"
    function _dnsName(string calldata userLabel, string calldata taskLabel) internal view returns (bytes memory) {
        bytes memory task = bytes(taskLabel);
        bytes memory user = bytes(userLabel);
        require(task.length > 0 && task.length < 64 && user.length > 0 && user.length < 64, "bad label");
        return bytes.concat(bytes1(uint8(task.length)), task, bytes1(uint8(user.length)), user, PARENT_DNS);
    }

    /// "rent" + "alice" => namehash("rent.alice.hako-箱.eth")
    function _node(string calldata userLabel, string calldata taskLabel) internal view returns (bytes32) {
        bytes32 userNode = keccak256(abi.encodePacked(PARENT_NODE, keccak256(bytes(userLabel))));
        return keccak256(abi.encodePacked(userNode, keccak256(bytes(taskLabel))));
    }

    function _parseUint(string memory s, string memory key) internal pure returns (uint256 n) {
        bytes memory b = bytes(s);
        if (b.length == 0) revert BadRecord(key);
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) revert BadRecord(key);
            n = n * 10 + (c - 48);
        }
        if (n == 0) revert BadRecord(key);
    }

    function _parseAddress(string memory s, string memory key) internal pure returns (address) {
        bytes memory b = bytes(s);
        if (b.length != 42 || b[0] != "0" || (b[1] != "x" && b[1] != "X")) revert BadRecord(key);
        uint160 result;
        for (uint256 i = 2; i < 42; i++) {
            uint8 c = uint8(b[i]);
            uint8 v;
            if (c >= 48 && c <= 57) v = c - 48;        // 0-9
            else if (c >= 97 && c <= 102) v = c - 87;  // a-f
            else if (c >= 65 && c <= 70) v = c - 55;   // A-F
            else revert BadRecord(key);
            result = result * 16 + v;
        }
        return address(result);
    }
}

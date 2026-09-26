import { parseAbi, parseAbiItem } from "viem";

export const permissionedRegistryAbi = parseAbi(["function setResolver(uint256 anyId, address resolver)", "function setSubregistry(uint256 anyId, address registry)"]);
export const resolverInitAbi = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)"]);
export const registryInitAbi = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants)"]);
export const verifiableFactoryAbi = parseAbi([
	"function deployProxy(address implementation, uint256 salt, bytes data)",
	"event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
export const registrarAbi = parseAbi([
	"function isAvailable(string label) view returns (bool)",
	"function getPrice(uint64 duration) view returns (uint256)",
	"function PAYMENT_TOKEN() view returns (address)",
	"function MIN_DURATION() view returns (uint64)",
	"function register(string label, address owner, address resolver, uint64 duration) returns (uint256)",
]);
export const nameRegisteredEvent = parseAbiItem("event NameRegistered(uint256 indexed tokenId, string label, address owner, uint64 duration, uint256 price)");
export const registryAbi = parseAbi([
	"function findOwner(string label) view returns (address)",
	"function getSubregistry(string label) view returns (address)",
	"function setSubregistry(uint256 anyId, address registry)",
]);
export const factoryAbi = parseAbi([
	"function deployProxy(address implementation, uint256 salt, bytes data)",
	"function proxyLogic() view returns (address)",
	"event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
export const executorAbi = parseAbi([
	"function execute(string userLabel, string taskLabel)",
	"function taskKey(string userLabel, string taskLabel) view returns (bytes32)",
	"function lastRun(bytes32 key) view returns (uint256)",
]);
export const textByNodeAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
export const textByNameAbi = parseAbi(["function text(bytes name, string key) view returns (string)"]);
export const setTextByNodeAbi = parseAbi(["function setText(bytes32 node, string key, string value)"]);
export const setTextByNameAbi = parseAbi(["function setText(bytes name, string key, string value)"]);
export const multicallAbi = parseAbi(["function multicall(bytes[] data) returns (bytes[])"]);
export const unregisterAbi = parseAbi(["function unregister(uint256 anyId)"]);

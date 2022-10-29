const FlashloanContract = artifacts.require("Flashloan");

module.exports = function(deployer) {
  deployer.deploy(FlashloanContract);
};
require('dotenv').config();
const Web3 = require('web3');
const FlContract = require('./build/contracts/Flashloan.json');
const pancakeAbi = require('./abis/pancakeAbi.json');
const apeAbi = require('./abis/apeAbi.json');

const pancakeRouterAddr = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const apeswapRouterAddr = '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7';
const BUSDAddr = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
const WBNBAddr = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/*Arbitrage strategy
Borrowing BUSD tokens from BUSD-USDT pair on PancakeSwap
using those BUSD tokens to buy WBNB either from Pancake or from ApeSwap wherever at lower price
and then selling WBNB either on pancake or ApeSwap wherever at higher price 
*/

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.MAIN_URL)
  );

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIV_KEY);


const flashLoanContract = new web3.eth.Contract(
    FlContract.abi,
    FlContract.networks[networkId].address
  );

const pancakeSwap = new web3.eth.Contract(
  pancakeAbi,
  pancakeRouterAddr
);

const apeSwap = new web3.eth.Contract(
  apeAbi,
  apeswapRouterAddr
);

const DIRECTION = {
  PANCAKE_TO_APE: 0,
  APE_TO_PANCAKE: 1
};

 
const AMOUNT_BUSD_WEI = web3.utils.toBN(web3.utils.toWei('2000'));

const init = async () => {
  
  let BNBPrice;

  const updateBNBPrice = async () => {
    const BNBAddr = await pancakeSwap.methods.WETH().call();
    const result = await pancakeSwap.methods.getAmountsOut(web3.utils.toBN(web3.utils.toWei('1')), [BUSDAddr, BNBAddr]).call();
    //here .fromWei means given amount is devided by 10^18
    BNBPrice = web3.utils.fromWei(result[1].toString(), 'ether');
    //console.log(`1 BNB = ${BNBPrice} BUSD`)
  }

  //await updateBNBPrice();
  //setInterval(updateBNBPrice, 3000);
  
  web3.eth.subscribe('newBlockHeaders')
    .on('data', async block => {
      
      updateBNBPrice()
      
      console.log(`New block received. Block # ${block.number}`);
      const amountsWBNB = await Promise.all([
        // amount of WBNB for BUSD on pancake
        pancakeSwap.methods.getAmountsOut(AMOUNT_BUSD_WEI, [BUSDAddr, WBNBAddr]).call(),
        // amount of WBNB for BUSD on apeswap
        apeSwap.methods.getAmountsOut(AMOUNT_BUSD_WEI, [BUSDAddr, WBNBAddr]).call()

      ])

      // As getAmountsOut returns [amountIn,amountOut] and we want amountOut
      // that's why we are doing like that amountsWBNB[0][1].toString()

      const WBNBfromPancake = web3.utils.fromWei(amountsWBNB[0][1].toString(), 'ether') 
      const WBNBfromApeswap = web3.utils.fromWei(amountsWBNB[1][1].toString(), 'ether')
      
      const amountsBUSD = await Promise.all([
        //Amount of BUSD in exchange of WBNB on pancake
        pancakeSwap.methods.getAmountsOut(web3.utils.toBN(web3.utils.toWei(WBNBfromApeswap)), [WBNBAddr, BUSDAddr]).call(),
        //Amount of BUSD in exchange of WBNB on apeswap
        apeSwap.methods.getAmountsOut(web3.utils.toBN(web3.utils.toWei(WBNBfromPancake)), [WBNBAddr, BUSDAddr]).call()                                                                                                                      
        
      ]);
      
      const BUSDfromApeswap = web3.utils.fromWei(amountsBUSD[1][1].toString(), 'ether')
      const BUSDfromPancake = web3.utils.fromWei(amountsBUSD[0][1].toString(), 'ether')

      const BUSDinput = web3.utils.fromWei(AMOUNT_BUSD_WEI.toString(), 'ether') 
      console.log(`Arbitrage from pancake to Ape
                   BUSD input:${BUSDinput} 
                   BUSD output:${BUSDfromApeswap}`)
      
      console.log(`Arbitrage from Ape to Pancake
                   BUSD input:${BUSDinput} 
                   BUSD output:${BUSDfromPancake}`)
    
      const profitPA = BUSDfromApeswap-BUSDinput
      const profitAP = BUSDfromPancake-BUSDinput
      if(profitPA > 0 || profitAP > 0){
        console.log(`profitPA:${profitPA} profitAP:${profitAP}, BNBPrice:${BNBPrice}`)  
      }
      
      
      if (BUSDfromApeswap > BUSDinput){
        const tx = flashLoanContract.methods.flashSwap(BUSDAddr, AMOUNT_BUSD_WEI, 0);

        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);
        //note: after contract deployment we have to console.log these calculations remember
        const txCost = web3.utils.fromWei(gasCost.toString(), 'ether')*web3.utils.fromWei(gasPrice.toString(), 'ether')*BNBPrice;
        const profit = BUSDfromApeswap-(BUSDinput + txCost)
        console.log(profit)

        if(profit>0){
          console.log(`Arbitrage from Pancake to Ape expected profit:${profit}`)
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: FlContract.networks[networkId].address,
            data,// data: data is same as data only coz key and value are same
            gas: gasCost,
            gasPrice // I'll change it to avoid frontrunning
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }

      if(BUSDfromPancake > BUSDinput){
        const tx = flashLoanContract.methods.flashSwap(BUSDAddr, AMOUNT_BUSD_WEI, 1);

        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);
      
        const txCost = web3.utils.fromWei(gasCost.toString(), 'ether')*web3.utils.fromWei(gasPrice.toString(), 'ether')*BNBPrice;
        const profit = BUSDfromPancake-(BUSDinput + txCost)
        console.log(profit)

        if(profit>0){
          console.log(`Arbitrage from Ape to pancake expected profit:${profit}`)
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: FlContract.networks[networkId].address,
            data,
            gas: gasCost,
            gasPrice 
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }
      
      
    })
    .on('error', error => {
      console.log(error);
    });
  }

init();
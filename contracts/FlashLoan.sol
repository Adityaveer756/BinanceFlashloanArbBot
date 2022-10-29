// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./libraries/PancakeInterfaces.sol";
import "./libraries/IBEP20.sol"; 

interface IPancakeCallee {
    function pancakeCall(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}

contract FlashLoan is IPancakeCallee {
    
    address payable immutable owner;
    address private constant FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address private constant pancakeRouter = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address private constant apeswapRouter = 0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7;

    error NotEnoughFunds();

    constructor(){
        owner = payable(msg.sender);
    }
    
    function flashSwap(address _tokenBorrow, address tokenPair, address tokenArbitrage, uint _amount, uint _direction ) external {

        require(msg.sender == owner,"!owner");
        address pair = IPancakeFactory(FACTORY).getPair(_tokenBorrow, tokenPair);
        require(pair != address(0), "!pair");
    
        address token0 = IPancakePair(pair).token0();
        address token1 = IPancakePair(pair).token1();
        uint amount0Out = _tokenBorrow == token0 ? _amount : 0;
        uint amount1Out = _tokenBorrow == token1 ? _amount : 0;
    
        // need to pass some data to trigger PancakeCall
        bytes memory data = abi.encode(_tokenBorrow, tokenArbitrage, _amount, _direction);
    
        IPancakePair(pair).swap(amount0Out, amount1Out, address(this), data);
    }

    // called by pair contract
    function pancakeCall(
        address _sender,
        uint _amount0,
        uint _amount1,
        bytes calldata _data
        ) external override {

        address token0 = IPancakePair(msg.sender).token0();
        address token1 = IPancakePair(msg.sender).token1();
        address pair = IPancakeFactory(FACTORY).getPair(token0, token1);
        require(msg.sender == pair, "!pair");
        require(_sender == address(this), "!sender");
        
        (address tokenBorrow, address tokenArbitrage, uint amount, uint direction) = abi.decode(_data, (address, address, uint, uint));
    
        // about 0.3%
        uint fee = ((amount * 3) / 997) + 1;
        uint amountToRepay = amount + fee;
        //do arbitrage here
        if(direction == 0 ){
            //swaping flashloaned tokenBorrow(BUSD) for tokenArbitrage(WBNB) on Pancakeswap
            IBEP20(tokenBorrow).approve(pancakeRouter, amount);
            address[] memory path1;
            path1 = new address[](2) ;
            path1[0] = tokenBorrow;
            path1[1] = tokenArbitrage;  
            IPancakeRouter02(pancakeRouter).swapExactTokensForTokens(
                amount,
                1,//we can change it to avoid frontrunning
                path1,
                address(this),
                block.timestamp
                );
            //swaping tokenArbitrage(WBNB) for tokenBorrow(BUSD) on Apeswap
            IBEP20(tokenArbitrage).approve(apeswapRouter, IBEP20(tokenArbitrage).balanceOf(address(this)));
            address[] memory path2;
            path2 = new address[](2) ;
            path2[0] = tokenArbitrage;
            path2[1] = tokenBorrow;
            IPancakeRouter02(apeswapRouter).swapExactTokensForTokens(
                IBEP20(tokenArbitrage).balanceOf(address(this)), 
                1, 
                path2, 
                address(this), 
                block.timestamp
                );

        }else{
            //swaping tokenBorrow(BUSD) for tokenArbitrage(WBNB) on Apeswap
            IBEP20(tokenBorrow).approve(apeswapRouter, amount);
            address[] memory path1;
            path1 = new address[](2) ;
            path1[0] = tokenBorrow;
            path1[1] = tokenArbitrage;
            IPancakeRouter02(apeswapRouter).swapExactTokensForTokens(
                amount, 
                1, 
                path1, 
                address(this), 
                block.timestamp
                );
            //swaping tokenArbitrage(WBNB) for tokenBorrow(BUSD) on PancakeSwap
            IBEP20(tokenArbitrage).approve(pancakeRouter, IBEP20(tokenArbitrage).balanceOf(address(this)));
            address[] memory path2;
            path2 = new address[](2) ;
            path2[0] = tokenArbitrage;
            path2[1] = tokenBorrow;  
            IPancakeRouter02(pancakeRouter).swapExactTokensForTokens(
                IBEP20(tokenArbitrage).balanceOf(address(this)),
                1,
                path2,
                address(this),
                block.timestamp
                );
        }

        if(IBEP20(tokenBorrow).balanceOf(address(this)) < amountToRepay){ 
            revert NotEnoughFunds();
        }
        IBEP20(tokenBorrow).transfer(pair, amountToRepay);
        
        if(IBEP20(tokenBorrow).balanceOf(address(this)) != 0){ 
            IBEP20(tokenBorrow).transfer(owner,IBEP20(tokenBorrow).balanceOf(address(this)));
        }
    }

}

'use strict'

const request = require('superagent')
const BigNumber = require('bignumber.js')
const _ = require('lodash')
const NoAmountSpecifiedError = require('./errors/no-amount-specified-error.js')
const AssetsNotTradedError = require('./errors/assets-not-traded-error.js')

const API_URL = 'https://finance.yahoo.com/webservice/v1/symbols/allcurrencies/quote?format=json'

/**
 * ILP connector backend that uses the Yahoo Finance API for rates
 */
class YahooFinanceBackend {
  /**
   * Constructor
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   * @param {Object} opts.currencyWithLedgerPairs
   */
  constructor (opts) {
    this.spread = opts.spread || 0
    this.currencyWithLedgerPairs = opts.currencyWithLedgerPairs
    this.rates = {}
    this.connected = false
  }

  /**
   * Get the rates from the API
   *
   * returns Promise.<null>
   */
  connect () {
    if (this.connected) {
      return Promise.resolve()
    }

    return request.get(API_URL)
      .then((response) => {
        const quotes = response.body.list.resources
        for (let quote of quotes) {
          if (!quote.resource || quote.resource.classname !== 'Quote') {
            continue
          }
          const fields = quote.resource.fields
          const symbol = fields.symbol.slice(0,3)
          const price = fields.price
          this.rates[symbol] = price
        }
        this.connected = true
      })
  }

  /**
   * Get backend status
   *
   * @returns Promise.<Object>
   */
  getStatus () {
    return Promise.resolve({
      backendStatus: 'OK'
    })
  }

  _subtractSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).minus(this.spread))
  }

  _addSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).plus(this.spread))
  }

  /**
   * Get a quote for the given parameters
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String|Integer|BigNumber} params.source_amount The amount of the source asset we want to send (either this or the destination_amount must be set)
   * @param {String|Integer|BigNumber} params.destination_amount The amount of the destination asset we want to send (either this or the source_amount must be set)
   *
   * @return Promise.<Object>
   */
  getQuote (params) {
    // Get ratio between currencies and apply spread
    let sourceCurrency
    let destinationCurrency
    // TODO we should only need to do this translation once
    for (let pair of this.currencyWithLedgerPairs) {
      if (pair[0].indexOf(params.source_ledger) === 4 &&
        pair[1].indexOf(params.destination_ledger) === 4) {
          sourceCurrency = pair[0].slice(0, 3)
          destinationCurrency = pair[1].slice(0, 3)
        }
    }
    if (!sourceCurrency || !destinationCurrency) {
      return Promise.reject(new AssetsNotTradedError('Connector does not trade those assets'))
    }

    const sourceRate = this.rates[sourceCurrency]
    const destinationRate = this.rates[destinationCurrency]

    let rate = new BigNumber(destinationRate).div(sourceRate)
    rate = this._subtractSpread(rate)

    let sourceAmount
    let destinationAmount
    if (params.source_amount) {
      sourceAmount = new BigNumber(params.source_amount)
      destinationAmount = new BigNumber(params.source_amount).times(rate)
    } else if (params.destination_amount) {
      sourceAmount = new BigNumber(params.destination_amount).div(rate)
      destinationAmount = new BigNumber(params.destination_amount)
    } else {
      return Promise.reject(new NoAmountSpecifiedError('Must specify either source ' +
        'or destination amount to get quote'))
    }

    return Promise.resolve({
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: sourceAmount.toString(),
      destination_amount: destinationAmount.toString()
    })
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to the backend
   *
   * @returns Promise.<null>
   */
  submitPayment (payment) {
    return Promise.resolve()
  }
}

module.exports = YahooFinanceBackend


'use strict'

const request = require('superagent')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('./errors/assets-not-traded-error.js')
// This simple backend uses a fixed (large) source amount and a rate to generate
// the destination amount for the curve.
const PROBE_SOURCE_AMOUNT = 100000000

const API_URL = 'https://query.yahooapis.com/v1/public/yql'

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
    if (Array.isArray(opts.currencyWithLedgerPairs)) {
      this.pairs = opts.currencyWithLedgerPairs
    } else if (typeof opts.currencyWithLedgerPairs.toArray === 'function') {
      this.pairs = opts.currencyWithLedgerPairs.toArray()
    } else {
      throw new Error('Unexpected type for opts.currencyWithLedgerPairs', opts.currencyWithLedgerPairs)
    }
    this.currencies = this.pairs.reduce((currencies, pair) => {
      currencies.push(pair[0].slice(0,3))
      currencies.push(pair[1].slice(0,3))
      return currencies
    }, [])
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
      .query({
        q: 'select * from yahoo.finance.xchange where pair in ("USD' + this.currencies.join('", "USD') + '")',
        env: 'store://datatables.org/alltableswithkeys',
        format: 'json'
      })
      .then((response) => {
        const quotes = response.body.query.results.rate
        for (let quote of quotes) {
          const currency = quote.id.slice(3)
          if (quote.Rate === 'N/A') {
            throw new AssetsNotTradedError('Yahoo backend does not have rate for currency: ' + currency)
          }
          this.rates[currency] = quote.Rate
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
   *
   * @return Promise.<Object>
   */
  getCurve (params) {
    // Get ratio between currencies and apply spread
    let sourceCurrency
    let destinationCurrency
    // TODO we should only need to do this translation once
    for (let pair of this.pairs) {
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

    const sourceAmount = PROBE_SOURCE_AMOUNT
    const destinationAmount = new BigNumber(params.source_amount).times(rate).toString()
    return Promise.resolve({
      points: [[0, 0], [sourceAmount, +destinationAmount]]
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


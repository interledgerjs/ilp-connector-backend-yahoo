'use strict'

const request = require('superagent')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('./errors/assets-not-traded-error.js')
const debug = require('debug')('ilp-connector-backend-yahoo')
// This simple backend uses a fixed (large) source amount and a rate to generate
// the destination amount for the curve.
const PROBE_SOURCE_AMOUNT = 100000000

const API_URL = 'https://query.yahooapis.com/v1/public/yql'
const currencies = require('./currencies.json')

/**
 * ILP connector backend that uses the Yahoo Finance API for rates
 */
class YahooFinanceBackend {
  /**
   * Constructor
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   */
  constructor (opts) {
    this.spread = opts.spread || 0
    this.currencies = currencies
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
            continue
          }
          this.rates[currency] = quote.Rate
        }
        debug('got rates (vs USD): ' + JSON.stringify(this.rates))
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
   * @param {String} params.source_currency The currency code of the source ledger
   * @param {String} params.destination_currency The currency code of the destination ledger
   *
   * @return Promise.<Object>
   */
  getCurve (params) {
    debug('getCurve', params)
    // Get ratio between currencies and apply spread
    const sourceCurrency = params.source_currency
    const destinationCurrency = params.destination_currency
    if (!sourceCurrency || !destinationCurrency) {
      return Promise.reject(new Error('Must supply source_currency and destination_currency to get rate'))
    }

    const sourceRate = this.rates[sourceCurrency]
    const destinationRate = this.rates[destinationCurrency]
    if (!sourceRate || !destinationRate) {
      return Promise.reject(new AssetsNotTradedError('No rate found between: ' + sourceCurrency + ' and: ' + destinationCurrency))
    }

    let rate = new BigNumber(destinationRate).div(sourceRate)
    debug('rate (without spread) from ' + sourceCurrency + ' to ' + destinationCurrency + ' = ' + rate.toString())
    rate = this._subtractSpread(rate)
    debug('rate (with spread) from ' + sourceCurrency + ' to ' + destinationCurrency + ' = ' + rate.toString())

    const sourceAmount = PROBE_SOURCE_AMOUNT
    const destinationAmount = new BigNumber(sourceAmount).times(rate).toNumber()
    const curveResponse = {
      points: [[0, 0], [sourceAmount, destinationAmount]]
    }
    debug('curve from ' + sourceCurrency + ' to ' + destinationCurrency + ': ' + JSON.stringify(curveResponse))
    return Promise.resolve(curveResponse)
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


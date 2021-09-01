const _ = require('../src/index.js')
const h = require('./helpers.js')

test('error in source stream - exstream generator', () => {
  let i = 0
  _((write, next) => {
    i++
    if (i < 3) {
      write(i)
      next()
    } else if (i < 5) {
      write(Error(i))
      next()
    } else {
      write(_.nil)
    }
  })
    .errors((err, push) => {
      if (err.message === '3') push(null, 3)
    })
    .toArray(res => {
      expect(res).toEqual([1, 2, 3])
    })
})

test('fatal error in source stream - generator', () => {
  const errSkipped = []
  _(h.randomStringGenerator(5, 2))
    .errors((err, push) => {
      errSkipped.push(err)
    })
    .toArray(res => {
      console.log(res)
      expect(res.length).toBe(2)
      expect(res).toEqual(expect.not.arrayContaining(errSkipped))
    })
})

test('fatal error in source stream - async generator', async () => {
  const errSkipped = []
  const asyncGenerator = async function * () {
    for (let i = 0; i < 5; i++) {
      await h.sleep(10)
      if (i === 3) throw Error('can\t be 3!')
      else yield i
    }
  }

  await _(asyncGenerator())
    .errors((err, push) => {
      errSkipped.push(err)
      push(null, 33)
    })
    .toPromise()
    .then(res => {
      expect(res.length).toBe(4)
      expect(res).toEqual(expect.not.arrayContaining(errSkipped))
    })

  let errGenerated = null
  let errCatched = null
  await _(asyncGenerator())
    .errors((err, push) => {
      errGenerated = err
      push(err)
    })
    .toPromise()
    .catch(err => {
      errCatched = err
    })

  expect(errGenerated).not.toBe(null)
  expect(errCatched).toBe(errGenerated)
})

test('error in map', () => {
  _([1, 2, 3]).map(x => {
    if (x === 2) throw Error('can\'t be 2!!')
    else return x
  })
    .errors((err, push) => {
      if (err.originalData === 2) push(null, 5)
    })
    .toArray(res => {
      expect(res).toEqual([1, 5, 3])
    })
})

test('error in resolve', async () => {
  let errorCatched = false
  const res = await _([1, 2, 3]).map(async x => {
    await h.sleep(10)
    if (x === 2) throw Error('can\'t be 2')
    return x
  }).resolve()
    .errors((err) => {
      console.error(err.originalData)
      errorCatched = true
    })
    .toPromise()

  expect(errorCatched).toBe(true)
  expect(res).toEqual([1, 3])
})

test('error in promise chain', async () => {
  let errorCatched = false
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .then(x => {
      if (x === 2) throw Error('err2')
      return x
    })
    .catch(e => {
      return 2
    })
    .then(x => {
      if (x === 5) throw Error('err5')
      return x
    })
    .resolve(3)
    .errors(() => {
      errorCatched = true
    })
    .map(x => {
      if (x === 6) throw Error('err6')
      return x
    })
    .map(x => x) // test error pass through
    .errors((err, push) => {
      if (err.message === 'err6') push(null, 6)
    })
    .toPromise()

  expect(errorCatched).toBe(true)
  expect(res).toEqual([1, 2, 3, 4, 6])
})

test('synchronous tasks errors - chain is not synchronous', () => {
  let exception = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .map(async x => x * 2)
      .resolve()
      .batch(3)
      .value() // Throw error because the chain is not synchronous
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('synchronous tasks errors - .value() with multiple values', () => {
  let exception = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .value() // Throw error because the result has more than 1 value
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('synchronous tasks error - runtime error', () => {
  let exc = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .map(x => {
        if (x === 3) throw Error('NOO')
        return x * 2
      })
      .values()
  } catch (e) {
    exc = e
  }
  expect(exc).not.toBe(null)
  expect(exc.message).toBe('NOO')
  expect(exc.originalData).toBe(3)
})

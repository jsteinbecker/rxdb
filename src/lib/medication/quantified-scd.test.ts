import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quantifiedScdName } from '$lib/medication/quantified-scd';

describe('quantifiedScdName', () => {
	it('restates volume and concentration as content over volume', () => {
		assert.equal(
			quantifiedScdName('4 ML PEMBROLIZUMAB 25 MG/ML Injection'),
			'PEMBROLIZUMAB 100 MG/4ML Injection'
		);
		assert.equal(
			quantifiedScdName('0.5 ML insulin 100 UNT/ML / x 2 MG/ML Injection [Brand]'),
			'insulin 50 UNT/0.5ML / x 1 MG/0.5ML Injection [Brand]'
		);
	});
	it('leaves other names alone', () => {
		assert.equal(quantifiedScdName('vancomycin 1000 MG Injection'), 'vancomycin 1000 MG Injection');
		assert.equal(quantifiedScdName('4 ML pembrolizumab Injection'), '4 ML pembrolizumab Injection');
	});
});

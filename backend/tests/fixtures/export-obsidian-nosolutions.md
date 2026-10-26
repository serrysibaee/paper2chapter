---
title: "Softmax-Weighted Averages"
paper: "Softmax Weighting for Robust Averaging"
authors:
  - "(mock) A. Author"
generated: "2026-10-26T17:51:48+00:00"
generator: "paper2chapter"
model: "mock/mock"
audience: "undergraduate"
paper_id: "2ca5a031cb92"
tags:
  - paper2chapter
---

# Softmax-Weighted Averages

> [!info] About this chapter
> A textbook chapter based on *Softmax Weighting for Robust Averaging* by (mock) A. Author. Generated with mock/mock; machine-written, so verify important details against the paper. Marks: ✅ checked automatically · ❌ check failed · ➖ not checkable.

> [!abstract] Learning objectives
> - Explain why softmax produces valid weights
> - Derive the softmax of two scores as a logistic function
> - Implement a numerically stable softmax in Python

## Intuition first

*(Mock provider output: configure a real model in Settings for a real chapter.)*

Imagine asking several friends for advice and trusting some more than others. Softmax turns *how much you trust each friend* into percentages that add up to 100%, and the final advice is the trust-weighted average.

## Prerequisites

### Weighted averages

*(Mock provider output: configure a real model in Settings for a real chapter.)* A quick refresher on weighted averages.

The exponential $e^x$ is always positive and grows quickly.

$$
e^{a+b} = e^a e^b
$$

**Example.** $e^0 = 1$ and $e^1 \approx 2.718$.

> [!question] Check · multiple choice · easy ✅
> Which value is $e^0$?
>
> A. 0
> B. 1
> C. e

### Vectors and dot products

*(Mock provider output: configure a real model in Settings for a real chapter.)* A quick refresher on vectors and dot products.

The exponential $e^x$ is always positive and grows quickly.

$$
e^{a+b} = e^a e^b
$$

**Example.** $e^0 = 1$ and $e^1 \approx 2.718$.

> [!question] Check · multiple choice · easy ✅
> Which value is $e^0$?
>
> A. 0
> B. 1
> C. e

## Notation

| Symbol | Meaning |
|---|---|
| $z_i$ | score of item i |

## 1. From scores to weights

> [!tip] Intuition
> *(Mock provider output: configure a real model in Settings for a real chapter.)* Larger scores should get larger, but never negative, weights.

Given scores $z_1, \dots, z_n$, softmax defines

$$w_i = \frac{e^{z_i}}{\sum_{j=1}^n e^{z_j}}$$

Every $w_i > 0$ and $\sum_i w_i = 1$, so the $w_i$ are valid weights ([[#^ref-R1|1]]). The paper introduces this on page 1 (p. 1).


![[F1.png]]
*Figure 1: Softmax weights for three scores. (paper p. 3)*

### Derivation: Softmax of two scores is a logistic function

Show that $w_1 = \sigma(z_1 - z_2)$ where $\sigma(t) = 1/(1+e^{-t})$.

**Step 1.** *definition (E1)*

$$
w_1 = \frac{e^{z_1}}{e^{z_1} + e^{z_2}}
$$

Definition of softmax with $n=2$.

**Step 2.** ✅ *algebra*

$$
w_1 = \frac{1}{1 + e^{z_2 - z_1}}
$$

Divide numerator and denominator by $e^{z_1}$.

**Step 3.** ✅ *definition of the logistic function*

$$
w_1 = \sigma(z_1 - z_2)
$$

Recognise the logistic function with $t = z_1 - z_2$.

**Result:**

$$
w_1 = \sigma(z_1 - z_2)
$$

> [!example] Worked example: Weights for scores (0, ln 3) ✅
> Compute the softmax weights for $z = (0, \ln 3)$.
>
> 1. $e^0 = 1$, $e^{\ln 3} = 3$.
> 2. Sum is $4$, so $w = (1/4, 3/4)$.
>
> **Answer:** $w = (0.25, 0.75)$

### Check your understanding

> [!question] Exercise 3 · multiple choice · easy ✅
> If all scores are equal, what are the softmax weights?
>
> A. All 0
> B. All $1/n$
> C. All 1

## 2. Weighted averages in practice

> [!tip] Intuition
> *(Mock provider output: configure a real model in Settings for a real chapter.)* Larger scores should get larger, but never negative, weights.

Given scores $z_1, \dots, z_n$, softmax defines

$$w_i = \frac{e^{z_i}}{\sum_{j=1}^n e^{z_j}}$$

Every $w_i > 0$ and $\sum_i w_i = 1$, so the $w_i$ are valid weights ([[#^ref-R1|1]]). The paper introduces this on page 1 (p. 1).


![[F1.png]]
*Figure 1: Softmax weights for three scores. (paper p. 3)*

### Derivation: Softmax of two scores is a logistic function

Show that $w_1 = \sigma(z_1 - z_2)$ where $\sigma(t) = 1/(1+e^{-t})$.

**Step 1.** *definition (E1)*

$$
w_1 = \frac{e^{z_1}}{e^{z_1} + e^{z_2}}
$$

Definition of softmax with $n=2$.

**Step 2.** ✅ *algebra*

$$
w_1 = \frac{1}{1 + e^{z_2 - z_1}}
$$

Divide numerator and denominator by $e^{z_1}$.

**Step 3.** ✅ *definition of the logistic function*

$$
w_1 = \sigma(z_1 - z_2)
$$

Recognise the logistic function with $t = z_1 - z_2$.

**Result:**

$$
w_1 = \sigma(z_1 - z_2)
$$

> [!example] Worked example: Weights for scores (0, ln 3) ✅
> Compute the softmax weights for $z = (0, \ln 3)$.
>
> 1. $e^0 = 1$, $e^{\ln 3} = 3$.
> 2. Sum is $4$, so $w = (1/4, 3/4)$.
>
> **Answer:** $w = (0.25, 0.75)$

### Check your understanding

> [!question] Exercise 4 · multiple choice · easy ✅
> If all scores are equal, what are the softmax weights?
>
> A. All 0
> B. All $1/n$
> C. All 1

## Summary

*(Mock provider output: configure a real model in Settings for a real chapter.)* Softmax converts arbitrary scores into weights that are positive and sum to one; the output is the weighted average of the values.

### Key takeaways

- Softmax weights are positive and sum to 1
- Adding a constant to all scores does not change the weights

### Common misconceptions

- Softmax is not the same as normalising by the sum of scores

## Practice problems

> [!question] Exercise 1 · conceptual · easy
> Why must softmax weights be positive?

> [!question] Exercise 2 · math · medium ✅
> Compute $w_1$ for scores $z = (2, 0)$. Give 3 decimals.

> [!question] Exercise 3 · python · medium ✅
> Implement `softmax(z)` for a list of floats. Subtract the maximum score first for numerical stability.
>
> Starter code:
>
> ```python
> import math
>
> def softmax(z):
>     # your code here
>     pass
> ```

## Further reading

- **Reference R1 of the paper**, see reference list. original source of the idea ([[#^ref-R1|ref. 1]])

## References (from the paper)

1. A. Author. Robust estimation with learned weights. Journal of Examples, 2020. ^ref-R1
2. B. Builder. Combining estimates: a survey of averaging methods. Survey Press, 2018. ^ref-R2
3. C. Coder. Differentiable selection with the softmax function. Proc. ICML, 2019. ^ref-R3

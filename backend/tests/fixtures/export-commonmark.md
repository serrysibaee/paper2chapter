# Softmax-Weighted Averages

> **About this chapter**
>
> A textbook chapter based on *Softmax Weighting for Robust Averaging* by (mock) A. Author. Generated with mock/mock; machine-written, so verify important details against the paper.

> **Learning objectives**
>
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

> **Check · multiple choice · easy (checked)**
>
> Which value is $e^0$?
>
> A. 0
> B. 1
> C. e
>
> > **Solution**
> >
> > **Correct option: B**
> >
> > 1
> >
> > Any nonzero number to the power 0 equals 1.

### Vectors and dot products

*(Mock provider output: configure a real model in Settings for a real chapter.)* A quick refresher on vectors and dot products.

The exponential $e^x$ is always positive and grows quickly.

$$
e^{a+b} = e^a e^b
$$

**Example.** $e^0 = 1$ and $e^1 \approx 2.718$.

> **Check · multiple choice · easy (checked)**
>
> Which value is $e^0$?
>
> A. 0
> B. 1
> C. e
>
> > **Solution**
> >
> > **Correct option: B**
> >
> > 1
> >
> > Any nonzero number to the power 0 equals 1.

## Notation

| Symbol | Meaning |
|---|---|
| $z_i$ | score of item i |

## 1. From scores to weights

> **Intuition**
>
> *(Mock provider output: configure a real model in Settings for a real chapter.)* Larger scores should get larger, but never negative, weights.

Given scores $z_1, \dots, z_n$, softmax defines

$$w_i = \frac{e^{z_i}}{\sum_{j=1}^n e^{z_j}}$$

Every $w_i > 0$ and $\sum_i w_i = 1$, so the $w_i$ are valid weights ([1](#ref-R1)). The paper introduces this on page 1 (p. 1).


![Figure 1: Softmax weights for three scores.](F1.png)
*Figure 1: Softmax weights for three scores. (paper p. 3)*

### Derivation: Softmax of two scores is a logistic function

Show that $w_1 = \sigma(z_1 - z_2)$ where $\sigma(t) = 1/(1+e^{-t})$.

**Step 1.** *definition (E1)*

$$
w_1 = \frac{e^{z_1}}{e^{z_1} + e^{z_2}}
$$

Definition of softmax with $n=2$.

**Step 2.** (checked) *algebra*

$$
w_1 = \frac{1}{1 + e^{z_2 - z_1}}
$$

Divide numerator and denominator by $e^{z_1}$.

**Step 3.** (checked) *definition of the logistic function*

$$
w_1 = \sigma(z_1 - z_2)
$$

Recognise the logistic function with $t = z_1 - z_2$.

**Result:**

$$
w_1 = \sigma(z_1 - z_2)
$$

> **Worked example: Weights for scores (0, ln 3) (checked)**
>
> Compute the softmax weights for $z = (0, \ln 3)$.
>
> 1. $e^0 = 1$, $e^{\ln 3} = 3$.
> 2. Sum is $4$, so $w = (1/4, 3/4)$.
>
> **Answer:** $w = (0.25, 0.75)$

### Check your understanding

> **Exercise 3 · multiple choice · easy (checked)**
>
> If all scores are equal, what are the softmax weights?
>
> A. All 0
> B. All $1/n$
> C. All 1
>
> > **Solution**
> >
> > **Correct option: B**
> >
> > All $1/n$
> >
> > Equal numerators $e^{z}$ divided by $n e^{z}$ give $1/n$.

## 2. Weighted averages in practice

> **Intuition**
>
> *(Mock provider output: configure a real model in Settings for a real chapter.)* Larger scores should get larger, but never negative, weights.

Given scores $z_1, \dots, z_n$, softmax defines

$$w_i = \frac{e^{z_i}}{\sum_{j=1}^n e^{z_j}}$$

Every $w_i > 0$ and $\sum_i w_i = 1$, so the $w_i$ are valid weights ([1](#ref-R1)). The paper introduces this on page 1 (p. 1).


![Figure 1: Softmax weights for three scores.](F1.png)
*Figure 1: Softmax weights for three scores. (paper p. 3)*

### Derivation: Softmax of two scores is a logistic function

Show that $w_1 = \sigma(z_1 - z_2)$ where $\sigma(t) = 1/(1+e^{-t})$.

**Step 1.** *definition (E1)*

$$
w_1 = \frac{e^{z_1}}{e^{z_1} + e^{z_2}}
$$

Definition of softmax with $n=2$.

**Step 2.** (checked) *algebra*

$$
w_1 = \frac{1}{1 + e^{z_2 - z_1}}
$$

Divide numerator and denominator by $e^{z_1}$.

**Step 3.** (checked) *definition of the logistic function*

$$
w_1 = \sigma(z_1 - z_2)
$$

Recognise the logistic function with $t = z_1 - z_2$.

**Result:**

$$
w_1 = \sigma(z_1 - z_2)
$$

> **Worked example: Weights for scores (0, ln 3) (checked)**
>
> Compute the softmax weights for $z = (0, \ln 3)$.
>
> 1. $e^0 = 1$, $e^{\ln 3} = 3$.
> 2. Sum is $4$, so $w = (1/4, 3/4)$.
>
> **Answer:** $w = (0.25, 0.75)$

### Check your understanding

> **Exercise 4 · multiple choice · easy (checked)**
>
> If all scores are equal, what are the softmax weights?
>
> A. All 0
> B. All $1/n$
> C. All 1
>
> > **Solution**
> >
> > **Correct option: B**
> >
> > All $1/n$
> >
> > Equal numerators $e^{z}$ divided by $n e^{z}$ give $1/n$.

## Summary

*(Mock provider output: configure a real model in Settings for a real chapter.)* Softmax converts arbitrary scores into weights that are positive and sum to one; the output is the weighted average of the values.

### Key takeaways

- Softmax weights are positive and sum to 1
- Adding a constant to all scores does not change the weights

### Common misconceptions

- Softmax is not the same as normalising by the sum of scores

## Practice problems

> **Exercise 1 · conceptual · easy**
>
> Why must softmax weights be positive?
>
> > **Solution**
> >
> > Because $e^x > 0$ for every real $x$.
> >
> > Each weight is a ratio of positive numbers.

> **Exercise 2 · math · medium (checked)**
>
> Compute $w_1$ for scores $z = (2, 0)$. Give 3 decimals.
>
> > **Solution**
> >
> > $w_1 \approx 0.881$
> >
> > $w_1 = e^2/(e^2+1) = \sigma(2) \approx 0.8808$.

> **Exercise 3 · python · medium (checked)**
>
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
>
> > **Solution**
> >
> > See the reference solution.
> >
> > Subtracting $\max z$ leaves the weights unchanged but avoids overflow.
> >
> > ```python
> > import math
> >
> > def softmax(z):
> >     m = max(z)
> >     e = [math.exp(v - m) for v in z]
> >     s = sum(e)
> >     return [v / s for v in e]
> > ```
> >
> > Tests:
> >
> > ```python
> > w = softmax([0.0, math.log(3)])
> > assert abs(w[0] - 0.25) < 1e-9 and abs(w[1] - 0.75) < 1e-9
> > assert abs(sum(softmax([1000.0, 1000.0, 999.0])) - 1) < 1e-9
> > ```

## Further reading

- **Reference R1 of the paper**, see reference list. original source of the idea ([ref. 1](#ref-R1))

## References (from the paper)

1. <a id="ref-R1"></a>A. Author. Robust estimation with learned weights. Journal of Examples, 2020.
2. <a id="ref-R2"></a>B. Builder. Combining estimates: a survey of averaging methods. Survey Press, 2018.
3. <a id="ref-R3"></a>C. Coder. Differentiable selection with the softmax function. Proc. ICML, 2019.

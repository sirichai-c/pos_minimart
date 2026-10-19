# Sample change for testing automatic commit message generation.


def add_numbers(a: int, b: int) -> int:
    """Return the sum of two integers."""
    return a + b


def multiply_numbers(a: int, b: int) -> int:
    """Return the product of two integers."""
    return a * b


def subtract_numbers(a: int, b: int) -> int:
    """Return the difference between two integers."""
    return a - b


if __name__ == "__main__":
    print(f"2 + 3 = {add_numbers(2, 3)}")
    print(f"2 * 3 = {multiply_numbers(2, 3)}")
    print(f"8 - 3 = {subtract_numbers(8, 3)}")

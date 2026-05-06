// Sample C++ code for AST analysis
#include <iostream>
using namespace std;

class Calculator {
public:
    int add(int a, int b) {
        int result = a + b;
        return result;
    }
    
    int multiply(int x, int y) {
        for(int i = 0; i < 5; i++) {
            if(x > 0) {
                y = y * x;
            }
        }
        return y;
    }
};

int main() {
    int sum = 0;
    
    for(int i = 0; i < 10; i++) {
        if(i % 2 == 0) {
            sum = sum + i;
        }
    }
    
    while(sum > 0) {
        sum = sum - 1;
    }
    
    return 0;
}

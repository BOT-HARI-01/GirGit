import ollama

import re

def clean_ocr_text(raw_text):
    # Remove common noise from web UI
    noise_keywords = ["GeeksforGeeks", "Practice", "Contests", "Search", "Login", "Start Timer", "Courses"]
    lines = raw_text.splitlines()

    # Keep only relevant lines
    clean_lines = []
    for line in lines:
        if not any(keyword in line for keyword in noise_keywords):
            clean_lines.append(line.strip())

    # Optionally filter only lines with code-like content
    clean_lines = [line for line in clean_lines if re.match(r'[a-zA-Z0-9_].*', line)]

    return "\n".join(clean_lines)
with open('ocr_output.txt', 'r', encoding='utf-8') as file:
    extracted_text = file.read().strip()
cleaned_text = clean_ocr_text(extracted_text)
prompt = "For any give input correct it and then evaluate it,donot wrap the ouput in ' ' ``` '& wrap the code always in '```' Only. produce the code in the language that is seen in the input you can ignore any main functions and just answer the function correctly that satisfy the example output mentioned and can pass any text case, also explain how the problem in solved in fewer steps and mention time and space complexities also main thing "
stream = ollama.chat(
    model='llama3.2',
    messages=[{'role': 'user', 'content': extracted_text + prompt}],
    stream=True 
)
response = ''
for chunk in stream:
    response += chunk['message']['content']

print(response)



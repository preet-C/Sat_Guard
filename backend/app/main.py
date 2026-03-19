from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "SatGuard backend is running 🚀"}
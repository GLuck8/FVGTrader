from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    oanda_api_key: str = ""
    oanda_account_id: str = ""
    oanda_environment: str = "practice"  # "practice" | "live"

    supabase_url: str = ""
    supabase_service_key: str = ""

    secret_key: str = "dev-secret-change-me"
    environment: str = "development"

    @property
    def oanda_base_url(self) -> str:
        if self.oanda_environment == "live":
            return "https://api-fxtrade.oanda.com"
        return "https://api-fxpractice.oanda.com"

    @property
    def oanda_stream_url(self) -> str:
        if self.oanda_environment == "live":
            return "https://stream-fxtrade.oanda.com"
        return "https://stream-fxpractice.oanda.com"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
